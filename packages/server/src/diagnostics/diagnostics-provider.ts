import { type Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import {
  SyntaxKind,
  type SourceFile,
  type PropertyAssignment,
  type ObjectLiteralExpression,
  type JsxAttribute,
} from 'ts-morph';
import type { JsxAnalyzer } from '../static/jsx-analyzer.js';

const FLEX_CHILD_PROPERTIES = new Set([
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent', 'gap',
  'rowGap', 'columnGap',
]);

export class DiagnosticsProvider {
  private jsxAnalyzer: JsxAnalyzer;

  constructor(jsxAnalyzer: JsxAnalyzer) {
    this.jsxAnalyzer = jsxAnalyzer;
  }

  validate(uri: string, filePath: string): Diagnostic[] {
    const source = this.jsxAnalyzer.getSourceFile(filePath);
    if (!source) return [];

    const diagnostics: Diagnostic[] = [];

    for (const styleObj of findStyleObjects(source)) {
      const props = extractPropertyMap(styleObj);
      diagnostics.push(
        ...checkFlexPropertiesWithoutDisplay(props),
        ...checkWidthWithFlex(props),
        ...checkConflictingDimensions(props),
      );
    }

    return diagnostics;
  }
}

interface StyleProp {
  name: string;
  value: string;
  assignment: PropertyAssignment;
}

function findStyleObjects(source: SourceFile): ObjectLiteralExpression[] {
  const results: ObjectLiteralExpression[] = [];

  const allJsx = [
    ...source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const jsx of allJsx) {
    for (const attr of jsx.getAttributes()) {
      if (attr.getKind() !== SyntaxKind.JsxAttribute) continue;
      const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute)!;
      if (jsxAttr.getNameNode().getText() !== 'style') continue;

      const obj = getObjectLiteral(jsxAttr);
      if (obj) results.push(obj);
    }
  }

  return results;
}

function getObjectLiteral(jsxAttr: JsxAttribute): ObjectLiteralExpression | null {
  const init = jsxAttr.getInitializer();
  if (!init || init.getKind() !== SyntaxKind.JsxExpression) return null;
  const expr = init.asKind(SyntaxKind.JsxExpression)!.getExpression();
  if (!expr || expr.getKind() !== SyntaxKind.ObjectLiteralExpression) return null;
  return expr.asKind(SyntaxKind.ObjectLiteralExpression)!;
}

function extractPropertyMap(objLiteral: ObjectLiteralExpression): Map<string, StyleProp> {
  const props = new Map<string, StyleProp>();

  for (const prop of objLiteral.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const assignment = prop.asKind(SyntaxKind.PropertyAssignment)!;
    const name = assignment.getName();
    const initializer = assignment.getInitializer();
    if (!initializer) continue;

    let value = '';
    const kind = initializer.getKind();
    if (kind === SyntaxKind.StringLiteral) {
      value = initializer.asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
    } else if (kind === SyntaxKind.NumericLiteral) {
      value = String(initializer.asKind(SyntaxKind.NumericLiteral)!.getLiteralValue());
    } else {
      value = initializer.getText();
    }

    props.set(name, { name, value, assignment });
  }

  return props;
}

function makeDiagnostic(assignment: PropertyAssignment, message: string): Diagnostic {
  const source = assignment.getSourceFile();
  const start = assignment.getStartLineNumber() - 1;
  const startCol = assignment.getStart() - assignment.getStartLinePos();
  const end = assignment.getEndLineNumber() - 1;
  const endPos = assignment.getEnd();
  const endLineAndChar = source.compilerNode.getLineAndCharacterOfPosition(endPos);

  return {
    range: {
      start: { line: start, character: startCol },
      end: { line: end, character: endLineAndChar.character },
    },
    message,
    severity: DiagnosticSeverity.Warning,
    source: 'ui-ls',
  };
}

/**
 * Rule: flexDirection/justifyContent/alignItems etc. without display:'flex'
 */
function checkFlexPropertiesWithoutDisplay(props: Map<string, StyleProp>): Diagnostic[] {
  const displayProp = props.get('display');
  const isFlex = displayProp && (displayProp.value === 'flex' || displayProp.value === 'inline-flex');

  if (isFlex) return [];

  const diagnostics: Diagnostic[] = [];
  for (const [name, prop] of props) {
    if (FLEX_CHILD_PROPERTIES.has(name)) {
      diagnostics.push(
        makeDiagnostic(
          prop.assignment,
          `'${name}' has no effect without 'display: flex' on this element.`,
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * Rule: width set alongside flex shorthand (flex: 1, flex: '1 1 0%', etc.)
 */
function checkWidthWithFlex(props: Map<string, StyleProp>): Diagnostic[] {
  const flexProp = props.get('flex');
  const widthProp = props.get('width');

  if (!flexProp || !widthProp) return [];

  // flex: 1 or flex: '1 ...' — means the element grows, width may be ignored
  const flexVal = flexProp.value.trim();
  const isGrowing = flexVal === '1' || flexVal.startsWith('1 ') || flexVal === 'auto';
  if (!isGrowing) return [];

  return [
    makeDiagnostic(
      widthProp.assignment,
      `'width' may be ignored because 'flex: ${flexProp.value}' controls this element's size.`,
    ),
  ];
}

/**
 * Rule: minWidth > width (conflicting constraints)
 */
function checkConflictingDimensions(props: Map<string, StyleProp>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  checkDimensionPair(props, 'width', 'minWidth', diagnostics);
  checkDimensionPair(props, 'height', 'minHeight', diagnostics);

  return diagnostics;
}

function checkDimensionPair(
  props: Map<string, StyleProp>,
  dimName: string,
  minName: string,
  diagnostics: Diagnostic[],
): void {
  const dim = props.get(dimName);
  const min = props.get(minName);
  if (!dim || !min) return;

  const dimPx = parsePxValue(dim.value);
  const minPx = parsePxValue(min.value);
  if (dimPx === null || minPx === null) return;

  if (minPx > dimPx) {
    diagnostics.push(
      makeDiagnostic(
        min.assignment,
        `'${minName}: ${min.value}' is larger than '${dimName}: ${dim.value}' — the element will be forced to ${minPx}px.`,
      ),
    );
  }
}

function parsePxValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith('px')) {
    const num = parseFloat(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  const num = parseFloat(trimmed);
  if (String(num) === trimmed && Number.isFinite(num)) return num;
  return null;
}
