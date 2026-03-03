import type { CodeLens, CodeLensParams } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver';
import type { BoxModelData, ComputedStyles, ComponentInfo } from '@ui-ls/shared';
import type { CDPConnection } from '../cdp/cdp-connection.js';
import { SourceMapper } from '../source-mapping/source-mapper.js';
import { JsxAnalyzer } from '../static/jsx-analyzer.js';
import { extractInlineStyles } from '../static/style-extractor.js';
import { estimateLayout } from '../static/layout-estimator.js';

interface CodeLensData {
  filePath: string;
  line: number;
  column: number;
}

/**
 * Provides CodeLens items above JSX elements showing live dimensions.
 * Uses the resolve pattern: positions are cheap (static AST), titles are expensive (CDP).
 */
export class CodeLensProvider {
  private sourceMapper = new SourceMapper();
  private jsxAnalyzer: JsxAnalyzer;
  private connection: CDPConnection;

  constructor(jsxAnalyzer: JsxAnalyzer, connection: CDPConnection) {
    this.jsxAnalyzer = jsxAnalyzer;
    this.connection = connection;
  }

  onCodeLens(params: CodeLensParams): CodeLens[] {
    const filePath = uriToPath(params.textDocument.uri);
    const components = this.jsxAnalyzer.getAllComponents(filePath);

    return components.map((comp) => ({
      // ts-morph returns 1-based lines; LSP uses 0-based
      range: Range.create(comp.line - 1, 0, comp.line - 1, 0),
      data: { filePath, line: comp.line - 1, column: comp.column } satisfies CodeLensData,
    }));
  }

  async onCodeLensResolve(lens: CodeLens): Promise<CodeLens> {
    const data = lens.data as CodeLensData;
    if (!data) {
      lens.command = { title: '...', command: '' };
      return lens;
    }

    const title = await this.resolveTitle(data);
    lens.command = { title, command: '' };
    return lens;
  }

  private async resolveTitle(data: CodeLensData): Promise<string> {
    // Try live data first
    const client = this.connection.cdpClient;
    if (client) {
      try {
        const live = await this.sourceMapper.lookupLive(client, data.filePath, data.line, data.column);
        if (live) {
          return formatCodeLensTitle(live.componentInfo.name, live.boxModel, live.computedStyles, 'live');
        }
      } catch {
        // Fall through to static
      }
    }

    // Fall back to static analysis
    const comp = this.jsxAnalyzer.getComponentAt(data.filePath, data.line, data.column);
    if (!comp) return '...';

    const styles = this.extractStyles(data.filePath, data.line, data.column);
    const boxModel = Object.keys(styles).length > 0 ? estimateLayout(styles) : null;
    return formatCodeLensTitle(comp.name, boxModel, styles, 'estimated');
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

function formatCodeLensTitle(
  name: string,
  boxModel: BoxModelData | null,
  styles: ComputedStyles,
  source: 'live' | 'estimated',
): string {
  const parts: string[] = [name];

  if (boxModel) {
    const w = fmt(boxModel.content.width);
    const h = fmt(boxModel.content.height);
    parts.push(`${w} x ${h}`);
  }

  // Show display + flex-direction if flex
  const display = styles['display'];
  if (display && display !== 'block' && display !== 'initial' && display !== 'none') {
    const direction = styles['flex-direction'];
    parts.push(direction ? `${display} ${direction}` : display);
  }

  parts.push(`(${source})`);
  return parts.join(' \u00b7 ');
}

function fmt(n: number): string {
  if (n === 0) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
