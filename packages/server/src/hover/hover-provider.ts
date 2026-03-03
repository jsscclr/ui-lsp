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
  private sourceMapper = new SourceMapper();
  private jsxAnalyzer = new JsxAnalyzer();
  private hoverCache = new HoverCache();
  private connection: CDPConnection;

  constructor(connection: CDPConnection) {
    this.connection = connection;
  }

  updateDocument(uri: string, content: string): void {
    const filePath = uriToPath(uri);
    this.jsxAnalyzer.updateFile(filePath, content);
    this.hoverCache.invalidate();
  }

  removeDocument(uri: string): void {
    this.jsxAnalyzer.removeFile(uriToPath(uri));
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
      return await this.sourceMapper.lookupLive(client, filePath, line, col);
    } catch {
      // CDP lookup failed — fall through to static
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
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
