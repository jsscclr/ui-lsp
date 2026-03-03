import type { InlayHint, InlayHintParams } from 'vscode-languageserver';
import { InlayHintKind } from 'vscode-languageserver';
import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { ComputedStyles } from '@ui-ls/shared';
import type { CDPConnection } from '../cdp/cdp-connection.js';
import { SourceMapper } from '../source-mapping/source-mapper.js';
import { JsxAnalyzer } from '../static/jsx-analyzer.js';

interface StyleProperty {
  /** kebab-case CSS name */
  cssName: string;
  /** Literal value from source code */
  sourceValue: string;
  /** Line (0-based) of the property in the source */
  line: number;
  /** Column (0-based) past the end of the value */
  endColumn: number;
}

/** A group of style properties belonging to a single JSX element. */
interface StylePropertyGroup {
  /** 0-based line of the owning JSX element's opening tag */
  elementLine: number;
  /** Column of the `<` in the opening tag */
  elementColumn: number;
  properties: StyleProperty[];
}

/**
 * Provides inlay hints next to inline style properties showing computed values.
 * Only shows hints when the computed value differs from the source literal.
 */
export class InlayHintProvider {
  private sourceMapper = new SourceMapper();
  private jsxAnalyzer: JsxAnalyzer;
  private connection: CDPConnection;

  constructor(jsxAnalyzer: JsxAnalyzer, connection: CDPConnection) {
    this.jsxAnalyzer = jsxAnalyzer;
    this.connection = connection;
  }

  async onInlayHint(params: InlayHintParams): Promise<InlayHint[]> {
    const filePath = uriToPath(params.textDocument.uri);
    const source = this.jsxAnalyzer.getSourceFile(filePath);
    if (!source) return [];

    // Find style properties grouped by their owning JSX element
    const groups = findStylePropertyGroups(source, params.range.start.line, params.range.end.line);
    if (groups.length === 0) return [];

    // Look up computed styles per element
    const computedByPropKey = await this.getComputedStyles(filePath, groups);

    const hints: InlayHint[] = [];
    for (const group of groups) {
      for (const prop of group.properties) {
        const computed = computedByPropKey.get(propKey(prop));
        if (!computed) continue;

        const computedValue = computed[prop.cssName];
        if (!computedValue) continue;

        // Only show hint when computed value differs from source literal
        if (normalizeValue(computedValue) === normalizeValue(prop.sourceValue)) continue;

        hints.push({
          position: { line: prop.line, character: prop.endColumn },
          label: ` = ${computedValue}`,
          kind: InlayHintKind.Parameter,
          paddingLeft: true,
        });
      }
    }

    return hints;
  }

  /**
   * For each element group, look up computed styles via the fiber bridge.
   * Returns a map from property key (line:col) to computed styles.
   */
  private async getComputedStyles(
    filePath: string,
    groups: StylePropertyGroup[],
  ): Promise<Map<string, ComputedStyles>> {
    const client = this.connection.cdpClient;
    const result = new Map<string, ComputedStyles>();
    if (!client) return result;

    for (const group of groups) {
      try {
        const comp = this.jsxAnalyzer.getComponentAt(
          filePath,
          group.elementLine,
          group.elementColumn,
        );
        if (!comp) continue;

        const live = await this.sourceMapper.lookupLive(
          client, filePath, comp.line - 1, comp.column,
        );
        if (!live) continue;

        // Map computed styles only to this element's properties
        for (const prop of group.properties) {
          result.set(propKey(prop), live.computedStyles);
        }
      } catch {
        // Skip this element
      }
    }

    return result;
  }
}

function propKey(prop: StyleProperty): string {
  return `${prop.line}:${prop.endColumn}`;
}

/**
 * Walk the AST to find inline style properties, grouped by JSX element.
 * Each group tracks the element's position so we can look up its fiber.
 */
function findStylePropertyGroups(
  source: SourceFile,
  startLine: number,
  endLine: number,
): StylePropertyGroup[] {
  const groups: StylePropertyGroup[] = [];

  const allJsx = [
    ...source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const jsx of allJsx) {
    // Quick range check (ts-morph lines are 1-based, LSP is 0-based)
    const jsxLine = jsx.getStartLineNumber() - 1;
    if (jsxLine > endLine) continue;

    for (const attr of jsx.getAttributes()) {
      if (attr.getKind() !== SyntaxKind.JsxAttribute) continue;
      const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute)!;
      if (jsxAttr.getNameNode().getText() !== 'style') continue;

      const init = jsxAttr.getInitializer();
      if (!init || init.getKind() !== SyntaxKind.JsxExpression) continue;

      const expr = init.asKind(SyntaxKind.JsxExpression)!.getExpression();
      if (!expr || expr.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

      const objLiteral = expr.asKind(SyntaxKind.ObjectLiteralExpression)!;
      const properties: StyleProperty[] = [];

      for (const prop of objLiteral.getProperties()) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const assignment = prop.asKind(SyntaxKind.PropertyAssignment)!;
        const propName = assignment.getName();
        const initializer = assignment.getInitializer();
        if (!initializer) continue;

        const cssName = camelToKebab(propName);
        const propLine = assignment.getStartLineNumber() - 1;

        // Only include properties in the visible range
        if (propLine < startLine || propLine > endLine) continue;

        let sourceValue = '';
        const kind = initializer.getKind();
        if (kind === SyntaxKind.StringLiteral) {
          sourceValue = initializer.asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
        } else if (kind === SyntaxKind.NumericLiteral) {
          const num = initializer.asKind(SyntaxKind.NumericLiteral)!.getLiteralValue();
          sourceValue = needsPxSuffix(cssName) ? `${num}px` : String(num);
        } else {
          continue; // Skip non-literal values — can't meaningfully compare
        }

        const endPos = initializer.getEnd();
        const lineAndChar = source.compilerNode.getLineAndCharacterOfPosition(endPos);

        properties.push({
          cssName,
          sourceValue,
          line: propLine,
          endColumn: lineAndChar.character,
        });
      }

      if (properties.length > 0) {
        // Use the JSX element's own position for the fiber lookup
        const elementColumn = jsx.getStart() - jsx.getStartLinePos();
        groups.push({
          elementLine: jsxLine,
          elementColumn,
          properties,
        });
      }
    }
  }

  return groups;
}

/** Normalize values for comparison (strip whitespace, lowercase). */
function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

const UNITLESS_PROPERTIES = new Set([
  'animation-iteration-count', 'column-count', 'columns', 'flex',
  'flex-grow', 'flex-shrink', 'font-weight', 'line-height', 'opacity',
  'order', 'orphans', 'tab-size', 'widows', 'z-index', 'zoom',
]);

function needsPxSuffix(property: string): boolean {
  return !UNITLESS_PROPERTIES.has(property);
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
