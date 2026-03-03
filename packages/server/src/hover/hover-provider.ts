import type { Hover, TextDocumentPositionParams } from 'vscode-languageserver';
import { MarkupKind } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { HoverData, ComputedStyles, StaticHoverData } from '@ui-ls/shared';
import type { CDPConnection } from '../cdp/cdp-connection.js';
import { SourceMapper } from '../source-mapping/source-mapper.js';
import { JsxAnalyzer } from '../static/jsx-analyzer.js';
import { extractInlineStyles } from '../static/style-extractor.js';
import { estimateLayout } from '../static/layout-estimator.js';
import { formatHoverContent } from './hover-content.js';
import { HoverCache } from './hover-cache.js';

/**
 * Handles textDocument/hover requests.
 * Tries CDP live data first, falls back to static analysis.
 */
export class HoverProvider {
  private jsxAnalyzer: JsxAnalyzer;
  private hoverCache = new HoverCache();
  private connection: CDPConnection;
  private sourceMapper: SourceMapper;

  constructor(jsxAnalyzer: JsxAnalyzer, connection: CDPConnection, sourceMapper: SourceMapper) {
    this.jsxAnalyzer = jsxAnalyzer;
    this.connection = connection;
    this.sourceMapper = sourceMapper;
  }

  invalidate(filePath: string): void {
    this.hoverCache.invalidate();
    this.invalidateBrowserSourceMapCache(filePath);
  }

  async onHover(
    params: TextDocumentPositionParams,
    getDocument: (uri: string) => TextDocument | undefined,
  ): Promise<Hover | null> {
    const doc = getDocument(params.textDocument.uri);
    if (!doc) return null;

    const filePath = uriToPath(params.textDocument.uri);
    const line = params.position.line;
    const col = params.position.character;

    // Check cache
    const cacheKey = HoverCache.makeKey(filePath, line, col);
    const cached = this.hoverCache.get(cacheKey);
    if (cached) {
      return { contents: { kind: MarkupKind.Markdown, value: cached } };
    }

    // Try live CDP data first
    let hoverData = await this.tryLiveData(filePath, line, col);

    // Fall back to static analysis
    if (!hoverData) {
      hoverData = this.tryStaticData(filePath, line, col);
    }

    if (!hoverData) return null;

    const content = formatHoverContent(hoverData);
    this.hoverCache.set(cacheKey, content);

    return { contents: { kind: MarkupKind.Markdown, value: content } };
  }

  private async tryLiveData(
    filePath: string,
    line: number,
    col: number,
  ): Promise<HoverData | null> {
    const client = this.connection.cdpClient;
    if (!client) return null;

    try {
      // Use the JSX element name to disambiguate when multiple fibers match the same line
      const componentInfo = this.jsxAnalyzer.getComponentAt(filePath, line, col);
      const expectedName = componentInfo?.name;

      // LSP lines are 0-based; the fiber lookup handles conversion internally
      return await this.sourceMapper.lookupLive(client, filePath, line, col, expectedName);
    } catch (err) {
      console.error('[ui-ls] Live lookup failed:', err);
      return null;
    }
  }

  private tryStaticData(
    filePath: string,
    line: number,
    col: number,
  ): StaticHoverData | null {
    const componentInfo = this.jsxAnalyzer.getComponentAt(filePath, line, col);
    if (!componentInfo) return null;

    // Get the source file from the analyzer for style extraction
    const styles = this.extractStyles(filePath, line, col);
    const boxModel = Object.keys(styles).length > 0 ? estimateLayout(styles) : null;

    return {
      source: 'estimated',
      componentInfo,
      boxModel,
      computedStyles: styles,
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
   * Clear the browser-side source map cache for a file that changed.
   * The cache key is a browser URL, so we match by file suffix.
   */
  private invalidateBrowserSourceMapCache(filePath: string): void {
    const client = this.connection.cdpClient;
    if (!client) return;

    const suffix = filePath.split('/').slice(-2).join('/');
    const escapedSuffix = suffix.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    client.send('Runtime.evaluate', {
      expression: `(function() {
        var c = window.__UI_LS_SM_CACHE__;
        if (!c) return;
        Object.keys(c).forEach(function(k) {
          if (k.indexOf('${escapedSuffix}') !== -1) delete c[k];
        });
      })()`,
      returnByValue: true,
      awaitPromise: false,
    }).catch(() => {});
  }
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
