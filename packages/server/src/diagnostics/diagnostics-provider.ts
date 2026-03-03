import { type Diagnostic, DiagnosticSeverity, type Range } from 'vscode-languageserver';
import {
  SyntaxKind,
  type SourceFile,
  type PropertyAssignment,
  type ObjectLiteralExpression,
  type JsxAttribute,
} from 'ts-morph';
import type { JsxAnalyzer } from '../static/jsx-analyzer.js';
import type { DiagnosticData, StyleAttrData } from './diagnostic-data.js';
import type { TokenStore } from '../tokens/token-store.js';
import { CSS_PROPERTY_TO_TOKEN_TYPE } from '../tokens/property-mapping.js';
import { parseColor, colorToHex } from '../static/color-parser.js';

const FLEX_CHILD_PROPERTIES = new Set([
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent', 'gap',
  'rowGap', 'columnGap',
]);

export class DiagnosticsProvider {
  private jsxAnalyzer: JsxAnalyzer;
  private tokenStore: TokenStore | null = null;

  constructor(jsxAnalyzer: JsxAnalyzer) {
    this.jsxAnalyzer = jsxAnalyzer;
  }

  setTokenStore(store: TokenStore | null): void {
    this.tokenStore = store;
  }

  validate(uri: string, filePath: string): Diagnostic[] {
    const source = this.jsxAnalyzer.getSourceFile(filePath);
    if (!source) return [];

    const diagnostics: Diagnostic[] = [];

    for (const styleObj of findStyleObjects(source)) {
      const props = extractPropertyMap(styleObj);
      const styleAttr = buildStyleAttrData(styleObj, props);
      diagnostics.push(
        ...checkFlexPropertiesWithoutDisplay(props, styleAttr),
        ...checkWidthWithFlex(props, styleAttr),
        ...checkConflictingDimensions(props, styleAttr),
      );
      if (this.tokenStore) {
        diagnostics.push(
          ...checkHardcodedTokenValue(props, styleAttr, this.tokenStore),
        );
      }
    }

    return diagnostics;
  }
}

export interface StyleProp {
  name: string;
  value: string;
  assignment: PropertyAssignment;
}

export function findStyleObjects(source: SourceFile): ObjectLiteralExpression[] {
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

export function extractPropertyMap(objLiteral: ObjectLiteralExpression): Map<string, StyleProp> {
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

/** Build StyleAttrData from a style={{...}} ObjectLiteralExpression node. */
export function buildStyleAttrData(
  objLiteral: ObjectLiteralExpression,
  props: Map<string, StyleProp>,
): StyleAttrData {
  const source = objLiteral.getSourceFile();

  const objStart = objLiteral.getStart();
  const objStartLine = objLiteral.getStartLineNumber() - 1;
  const objStartCol = objStart - objLiteral.getStartLinePos();

  const objEnd = objLiteral.getEnd();
  const objEndLC = source.compilerNode.getLineAndCharacterOfPosition(objEnd);

  const existingProps: StyleAttrData['existingProps'] = [];
  for (const [, prop] of props) {
    existingProps.push({
      name: prop.name,
      value: prop.value,
      range: nodeRange(prop.assignment),
    });
  }

  return {
    objLiteralStart: { line: objStartLine, character: objStartCol },
    objLiteralEnd: { line: objEndLC.line, character: objEndLC.character },
    existingProps,
  };
}

function nodeRange(node: PropertyAssignment): Range {
  const source = node.getSourceFile();
  const start = node.getStartLineNumber() - 1;
  const startCol = node.getStart() - node.getStartLinePos();
  const endPos = node.getEnd();
  const endLC = source.compilerNode.getLineAndCharacterOfPosition(endPos);
  return {
    start: { line: start, character: startCol },
    end: { line: endLC.line, character: endLC.character },
  };
}

function makeDiagnostic(
  assignment: PropertyAssignment,
  message: string,
  data: DiagnosticData,
): Diagnostic {
  return {
    range: nodeRange(assignment),
    message,
    severity: DiagnosticSeverity.Warning,
    source: 'ui-ls',
    data,
  };
}

/**
 * Rule: flexDirection/justifyContent/alignItems etc. without display:'flex'
 */
function checkFlexPropertiesWithoutDisplay(
  props: Map<string, StyleProp>,
  styleAttr: StyleAttrData,
): Diagnostic[] {
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
          { ruleId: 'flex-without-display', styleAttr, fixContext: { propName: name } },
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * Rule: width set alongside flex shorthand (flex: 1, flex: '1 1 0%', etc.)
 */
function checkWidthWithFlex(
  props: Map<string, StyleProp>,
  styleAttr: StyleAttrData,
): Diagnostic[] {
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
      { ruleId: 'width-with-flex', styleAttr, fixContext: {} },
    ),
  ];
}

/**
 * Rule: minWidth > width (conflicting constraints)
 */
function checkConflictingDimensions(
  props: Map<string, StyleProp>,
  styleAttr: StyleAttrData,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  checkDimensionPair(props, 'width', 'minWidth', styleAttr, diagnostics);
  checkDimensionPair(props, 'height', 'minHeight', styleAttr, diagnostics);

  return diagnostics;
}

function checkDimensionPair(
  props: Map<string, StyleProp>,
  dimName: string,
  minName: string,
  styleAttr: StyleAttrData,
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
        { ruleId: 'conflicting-dimensions', styleAttr, fixContext: { dimName, minName } },
      ),
    );
  }
}

/**
 * Rule: inline value matches a design token — suggest using the token.
 */
function checkHardcodedTokenValue(
  props: Map<string, StyleProp>,
  styleAttr: StyleAttrData,
  tokenStore: TokenStore,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [name, prop] of props) {
    const tokenType = CSS_PROPERTY_TO_TOKEN_TYPE[name];
    if (!tokenType) continue;

    const normalized = normalizeInlineValue(prop.value, tokenType);
    if (normalized === null) continue;

    const matches = tokenStore.findByValue(normalized);
    if (matches.length === 0) continue;

    const tokenNames = matches.map((t) => `'${t.path}'`).join(', ');
    diagnostics.push({
      range: nodeRange(prop.assignment),
      message: `'${prop.value}' matches design token ${tokenNames}.`,
      severity: DiagnosticSeverity.Information,
      source: 'ui-ls',
      data: {
        ruleId: 'hardcoded-token-value',
        styleAttr,
        fixContext: {
          propName: name,
          matches: matches.map((t) => ({ tokenPath: t.path, tokenCssValue: t.cssValue })),
        },
      } satisfies DiagnosticData,
    });
  }

  return diagnostics;
}

/** Normalize an inline style value to the same canonical form as the token store. */
function normalizeInlineValue(value: string, tokenType: string): string | null {
  switch (tokenType) {
    case 'color': {
      const parsed = parseColor(value);
      return parsed ? colorToHex(parsed) : null;
    }
    case 'dimension': {
      const trimmed = value.trim().toLowerCase();
      // Numeric literal in source (e.g. padding: 16) — append px
      const num = Number(trimmed);
      if (!Number.isNaN(num) && String(num) === trimmed) return `${num}px`;
      return trimmed;
    }
    case 'fontWeight':
      return String(value).trim();
    case 'fontFamily':
      return value.trim();
    case 'duration':
      return value.trim().toLowerCase();
    default:
      return null;
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
