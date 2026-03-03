import { SyntaxKind } from 'ts-morph';
import type { CursorPositionParams, InspectorData, InlineStyleInfo, ComputedStyles, BoxModelData } from '@ui-ls/shared';
import type { CDPConnection } from '../cdp/cdp-connection.js';
import { SourceMapper } from '../source-mapping/source-mapper.js';
import { JsxAnalyzer } from '../static/jsx-analyzer.js';
import { extractInlineStyles } from '../static/style-extractor.js';
import { estimateLayout } from '../static/layout-estimator.js';
import type { TokenStore } from '../tokens/token-store.js';
import { CSS_PROPERTY_TO_TOKEN_TYPE } from '../tokens/property-mapping.js';
import { parseColor, colorToHex } from '../static/color-parser.js';

export interface LiveDataEvent {
  uri: string;
  line: number;
  column: number;
  boxModel: BoxModelData;
  computedStyles: ComputedStyles;
}

/**
 * Handles ui-ls/cursorPosition notifications.
 * Resolves cursor position to component data (live or static) and pushes
 * InspectorData back to the client for the webview panel.
 */
export class InspectorProvider {
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private lastKey = '';
  private tokenStore: TokenStore | null = null;

  /** Optional callback fired when live data arrives for the cursor element. */
  onLiveData: ((event: LiveDataEvent) => void) | null = null;

  constructor(
    private jsxAnalyzer: JsxAnalyzer,
    private sourceMapper: SourceMapper,
    private getConnection: () => CDPConnection,
    private sendData: (data: InspectorData | null) => void,
  ) {}

  setTokenStore(store: TokenStore | null): void {
    this.tokenStore = store;
  }

  onCursorPosition(params: CursorPositionParams): void {
    // Debounce: only process after 100ms of quiet
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.resolve(params);
    }, 100);
  }

  private resolve(params: CursorPositionParams): void {
    const filePath = uriToPath(params.uri);
    const line = params.line;
    const col = params.character;

    // Skip if cursor resolved to the same component location
    const key = `${filePath}:${line}:${col}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    // Increment generation so stale lookups are discarded
    const gen = ++this.generation;

    // Check if cursor is on a JSX element at all
    const componentInfo = this.jsxAnalyzer.getComponentAt(filePath, line, col);
    if (!componentInfo) {
      this.sendData(null);
      return;
    }

    // Try live data first, fall back to static
    this.resolveLive(params.uri, filePath, line, col, componentInfo.name, gen)
      .then((data) => {
        if (this.generation !== gen) return; // stale
        if (data) {
          this.sendData(data);
        } else {
          this.sendData(this.resolveStatic(filePath, line, col, componentInfo.name));
        }
      })
      .catch(() => {
        if (this.generation !== gen) return;
        this.sendData(this.resolveStatic(filePath, line, col, componentInfo.name));
      });
  }

  private async resolveLive(
    uri: string,
    filePath: string,
    line: number,
    col: number,
    componentName: string,
    gen: number,
  ): Promise<InspectorData | null> {
    const client = this.getConnection().cdpClient;
    if (!client) return null;

    const liveData = await this.sourceMapper.lookupLive(client, filePath, line, col, componentName);
    if (!liveData || this.generation !== gen) return null;

    // Fire live data event for live diagnostics (zero extra CDP cost)
    this.onLiveData?.({
      uri,
      line,
      column: col,
      boxModel: liveData.boxModel,
      computedStyles: liveData.computedStyles,
    });

    // Extract inline style info with source ranges
    const inlineStyles = this.extractInlineStylesWithRanges(filePath, line, col);
    const tokenMatches = this.buildTokenMatches(inlineStyles);

    return {
      componentName: liveData.componentInfo.name,
      filePath: liveData.componentInfo.filePath,
      line: liveData.componentInfo.line,
      column: liveData.componentInfo.column,
      props: liveData.componentInfo.props,
      boxModel: liveData.boxModel,
      computedStyles: liveData.computedStyles,
      inlineStyles,
      ...(tokenMatches && { tokenMatches }),
      screenshot: liveData.screenshot ?? null,
      renderedHtml: liveData.renderedHtml ?? null,
      source: 'live',
    };
  }

  private resolveStatic(
    filePath: string,
    line: number,
    col: number,
    componentName: string,
  ): InspectorData {
    const styles = this.extractStyles(filePath, line, col);
    const boxModel = Object.keys(styles).length > 0 ? estimateLayout(styles) : null;
    const inlineStyles = this.extractInlineStylesWithRanges(filePath, line, col);
    const tokenMatches = this.buildTokenMatches(inlineStyles);

    const componentInfo = this.jsxAnalyzer.getComponentAt(filePath, line, col);

    return {
      componentName,
      filePath,
      line,
      column: col,
      props: componentInfo?.props ?? {},
      boxModel,
      computedStyles: styles,
      inlineStyles,
      ...(tokenMatches && { tokenMatches }),
      screenshot: null,
      renderedHtml: null,
      source: 'estimated',
    };
  }

  private extractStyles(filePath: string, line: number, col: number): ComputedStyles {
    try {
      const source = this.jsxAnalyzer.getSourceFile(filePath);
      if (!source) return {};
      return extractInlineStyles(source, line, col);
    } catch {
      return {};
    }
  }

  /**
   * Extract inline styles with source ranges for each property assignment.
   * Combines the patterns from extractInlineStyles and buildStyleAttrData.
   */
  private extractInlineStylesWithRanges(filePath: string, line: number, col: number): InlineStyleInfo[] {
    try {
      const source = this.jsxAnalyzer.getSourceFile(filePath);
      if (!source) return [];

      const pos = source.compilerNode.getPositionOfLineAndCharacter(line, col);
      const allJsx = [
        ...source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ];

      const target = allJsx.find((jsx) => {
        const start = jsx.getStart();
        const end = jsx.getEnd();
        return pos >= start && pos <= end;
      });
      if (!target) return [];

      for (const attr of target.getAttributes()) {
        if (attr.getKind() !== SyntaxKind.JsxAttribute) continue;
        const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute)!;
        if (jsxAttr.getNameNode().getText() !== 'style') continue;

        const init = jsxAttr.getInitializer();
        if (!init || init.getKind() !== SyntaxKind.JsxExpression) continue;
        const expr = init.asKind(SyntaxKind.JsxExpression)!.getExpression();
        if (!expr || expr.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

        const objLiteral = expr.asKind(SyntaxKind.ObjectLiteralExpression)!;
        const results: InlineStyleInfo[] = [];

        for (const prop of objLiteral.getProperties()) {
          if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
          const assignment = prop.asKind(SyntaxKind.PropertyAssignment)!;
          const camelName = assignment.getName();
          const initializer = assignment.getInitializer();
          if (!initializer) continue;

          // Extract value
          let value = '';
          const kind = initializer.getKind();
          if (kind === SyntaxKind.StringLiteral) {
            value = initializer.asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
          } else if (kind === SyntaxKind.NumericLiteral) {
            value = String(initializer.asKind(SyntaxKind.NumericLiteral)!.getLiteralValue());
          } else {
            value = initializer.getText();
          }

          // Compute range
          const startLine = assignment.getStartLineNumber() - 1;
          const startCol = assignment.getStart() - assignment.getStartLinePos();
          const endPos = assignment.getEnd();
          const endLC = source.compilerNode.getLineAndCharacterOfPosition(endPos);

          results.push({
            name: camelToKebab(camelName),
            camelName,
            value,
            range: {
              start: { line: startLine, character: startCol },
              end: { line: endLC.line, character: endLC.character },
            },
          });
        }

        return results;
      }

      return [];
    } catch {
      return [];
    }
  }

  /** Build token match map for inline styles. */
  private buildTokenMatches(inlineStyles: InlineStyleInfo[]): Record<string, string> | null {
    if (!this.tokenStore || inlineStyles.length === 0) return null;

    const matches: Record<string, string> = {};
    let hasMatches = false;

    for (const style of inlineStyles) {
      const tokenType = CSS_PROPERTY_TO_TOKEN_TYPE[style.camelName];
      if (!tokenType) continue;

      const normalized = normalizeForTokenMatch(style.value, tokenType);
      if (normalized === null) continue;

      const found = this.tokenStore.findByValue(normalized);
      if (found.length > 0) {
        matches[style.name] = found[0].path;
        hasMatches = true;
      }
    }

    return hasMatches ? matches : null;
  }
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/** Normalize an inline value for token matching (mirrors diagnostics-provider logic). */
function normalizeForTokenMatch(value: string, tokenType: string): string | null {
  switch (tokenType) {
    case 'color': {
      const parsed = parseColor(value);
      return parsed ? colorToHex(parsed) : null;
    }
    case 'dimension': {
      const trimmed = value.trim().toLowerCase();
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

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
