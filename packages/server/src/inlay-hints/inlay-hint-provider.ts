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

    // Find style properties in the visible range
    const styleProps = findStyleProperties(source, params.range.start.line, params.range.end.line);
    if (styleProps.length === 0) return [];

    // Get computed styles from the browser for components in this range
    const computedByLine = await this.getComputedStylesForRange(filePath, styleProps);

    const hints: InlayHint[] = [];
    for (const prop of styleProps) {
      const computed = computedByLine.get(prop.line);
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

    return hints;
  }

  /**
   * For each style property, find the parent JSX element and get computed styles.
   * Groups by JSX element line to avoid redundant CDP lookups.
   */
  private async getComputedStylesForRange(
    filePath: string,
    styleProps: StyleProperty[],
  ): Promise<Map<number, ComputedStyles>> {
    const client = this.connection.cdpClient;
    const result = new Map<number, ComputedStyles>();
    if (!client) return result;

    // Deduplicate lookups by the JSX element line
    const elementLines = new Set<number>();
    for (const prop of styleProps) {
      elementLines.add(prop.line);
    }

    // Get computed styles for each unique element location
    const seen = new Set<number>();
    for (const prop of styleProps) {
      if (seen.has(prop.line)) continue;
      seen.add(prop.line);

      try {
        // Find the parent JSX element for this style property
        const comp = this.jsxAnalyzer.getComponentAt(filePath, prop.line, 0);
        if (!comp) continue;

        const live = await this.sourceMapper.lookupLive(client, filePath, comp.line - 1, comp.column);
        if (live) {
          // Map computed styles to all style property lines within this element
          for (const p of styleProps) {
            if (p.line >= (comp.line - 1)) {
              result.set(p.line, live.computedStyles);
            }
          }
        }
      } catch {
        // Skip this element
      }
    }

    return result;
  }
}

/**
 * Walk the AST to find all inline style properties in the given line range.
 * Looks for style={{...}} JSX attributes and extracts each property assignment.
 */
function findStyleProperties(
  source: SourceFile,
  startLine: number,
  endLine: number,
): StyleProperty[] {
  const results: StyleProperty[] = [];

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

        // End column is after the initializer
        const endPos = initializer.getEnd();
        const lineAndChar = source.compilerNode.getLineAndCharacterOfPosition(endPos);

        results.push({
          cssName,
          sourceValue,
          line: propLine,
          endColumn: lineAndChar.character,
        });
      }
    }
  }

  return results;
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
