import type { CursorPositionParams, InspectorData, ComputedStyles, BoxModelData } from '@ui-ls/shared';
import type { CDPConnection } from '../cdp/cdp-connection.js';
import { SourceMapper } from '../source-mapping/source-mapper.js';
import { JsxAnalyzer } from '../static/jsx-analyzer.js';
import { extractInlineStyles } from '../static/style-extractor.js';
import { estimateLayout } from '../static/layout-estimator.js';

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

  /** Optional callback fired when live data arrives for the cursor element. */
  onLiveData: ((event: LiveDataEvent) => void) | null = null;

  constructor(
    private jsxAnalyzer: JsxAnalyzer,
    private sourceMapper: SourceMapper,
    private getConnection: () => CDPConnection,
    private sendData: (data: InspectorData | null) => void,
  ) {}

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

    return {
      componentName: liveData.componentInfo.name,
      filePath: liveData.componentInfo.filePath,
      line: liveData.componentInfo.line,
      column: liveData.componentInfo.column,
      props: liveData.componentInfo.props,
      boxModel: liveData.boxModel,
      computedStyles: liveData.computedStyles,
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

    const componentInfo = this.jsxAnalyzer.getComponentAt(filePath, line, col);

    return {
      componentName,
      filePath,
      line,
      column: col,
      props: componentInfo?.props ?? {},
      boxModel,
      computedStyles: styles,
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
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
