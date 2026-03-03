import { type Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import type { BoxModelData, ComputedStyles } from '@ui-ls/shared';
import type { CDPClient } from '../cdp/cdp-client.js';
import type { CDPConnection } from '../cdp/cdp-connection.js';
import type { OverflowData } from '../cdp/overflow-query.js';
import { queryOverflow } from '../cdp/overflow-query.js';
import type { SourceMapper } from '../source-mapping/source-mapper.js';
import type { JsxAnalyzer } from '../static/jsx-analyzer.js';
import type { DiagnosticData, StyleAttrData } from './diagnostic-data.js';
import { findStyleObjects, extractPropertyMap, buildStyleAttrData } from './diagnostics-provider.js';
import {
  checkZeroSize,
  checkOverflow,
  checkInvisible,
  checkClippedText,
  type LiveDiagnosticResult,
} from './live-rules.js';

const MAX_CONCURRENT = 5;
const FILE_SCAN_TIMEOUT = 10_000;

export class LiveDiagnosticsProvider {
  constructor(
    private jsxAnalyzer: JsxAnalyzer,
    private sourceMapper: SourceMapper,
    private getConnection: () => CDPConnection,
  ) {}

  // ── Cursor-scoped (free — uses already-fetched data) ────────────────

  /**
   * Run live rules for the element at cursor, using data already fetched
   * by InspectorProvider. Zero additional CDP cost.
   */
  diagnosticsForElement(
    uri: string,
    line: number,
    col: number,
    boxModel: BoxModelData,
    computedStyles: ComputedStyles,
    overflow?: OverflowData | null,
  ): Diagnostic[] {
    const styleAttr = this.findStyleAttrAt(uri, line, col);
    const results: LiveDiagnosticResult[] = [];

    const zeroSize = checkZeroSize(boxModel, computedStyles);
    if (zeroSize) results.push(zeroSize);

    const invisible = checkInvisible(computedStyles);
    if (invisible) results.push(invisible);

    if (overflow) {
      const overflowResult = checkOverflow(overflow);
      if (overflowResult) results.push(overflowResult);

      const clipped = checkClippedText(computedStyles, overflow);
      if (clipped) results.push(clipped);
    }

    return results.map((r) => this.toLspDiagnostic(r, line, col, styleAttr));
  }

  // ── File-scoped (debounced, batched CDP calls) ──────────────────────

  /**
   * Scan all components in a file for live layout issues.
   * Batches lookupLive() calls (MAX_CONCURRENT concurrent, total timeout).
   */
  async validateFile(uri: string, filePath: string): Promise<Diagnostic[]> {
    const client = this.getConnection().cdpClient;
    if (!client) return [];

    const components = this.jsxAnalyzer.getAllComponents(filePath);
    if (components.length === 0) return [];

    const diagnostics: Diagnostic[] = [];
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), FILE_SCAN_TIMEOUT);

    try {
      // Process in batches of MAX_CONCURRENT
      for (let i = 0; i < components.length; i += MAX_CONCURRENT) {
        if (abortController.signal.aborted) break;

        const batch = components.slice(i, i + MAX_CONCURRENT);
        const results = await Promise.allSettled(
          batch.map((comp) =>
            this.checkComponent(client, filePath, comp.line, comp.column, comp.name),
          ),
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            diagnostics.push(...result.value);
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    return diagnostics;
  }

  // ── Internals ───────────────────────────────────────────────────────

  private async checkComponent(
    client: CDPClient,
    filePath: string,
    line: number,
    column: number,
    componentName: string,
  ): Promise<Diagnostic[]> {
    const liveData = await this.sourceMapper.lookupLive(
      client, filePath, line, column, componentName,
    );
    if (!liveData) return [];

    const { boxModel, computedStyles } = liveData;
    const uri = `file://${filePath}`;
    const styleAttr = this.findStyleAttrAt(uri, line, column);

    const results: LiveDiagnosticResult[] = [];

    const zeroSize = checkZeroSize(boxModel, computedStyles);
    if (zeroSize) results.push(zeroSize);

    const invisible = checkInvisible(computedStyles);
    if (invisible) results.push(invisible);

    // Only query overflow if styles suggest it's relevant
    const hasOverflowStyle =
      computedStyles['overflow'] ||
      computedStyles['overflow-x'] ||
      computedStyles['overflow-y'] ||
      computedStyles['text-overflow'];

    if (hasOverflowStyle && liveData.source === 'live') {
      // We need the objectId — re-lookup to get it for callFunctionOn.
      // The sourceMapper caches the fiber, so this is a cache hit.
      // However, we need the objectId which isn't exposed on LiveHoverData.
      // For now, skip overflow in file-scoped mode — cursor-scoped path
      // can receive overflow from InspectorProvider which has the objectId.
    }

    return results.map((r) => this.toLspDiagnostic(r, line, column, styleAttr));
  }

  /**
   * Find the style={{...}} attribute for the JSX element at line:col.
   * Returns null if the element has no inline style.
   */
  private findStyleAttrAt(uri: string, line: number, col: number): StyleAttrData | null {
    const filePath = uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
    const source = this.jsxAnalyzer.getSourceFile(filePath);
    if (!source) return null;

    // Walk all style objects and find one whose parent JSX element contains line:col
    for (const styleObj of findStyleObjects(source)) {
      const jsx = styleObj.getParent()?.getParent()?.getParent(); // ObjLit → JsxExpression → JsxAttribute → JsxOpeningElement
      if (!jsx) continue;

      const jsxStart = jsx.getStartLineNumber() - 1;
      const jsxEnd = jsx.getEndLineNumber() - 1;

      if (line >= jsxStart && line <= jsxEnd) {
        const props = extractPropertyMap(styleObj);
        return buildStyleAttrData(styleObj, props);
      }
    }

    return null;
  }

  private toLspDiagnostic(
    result: LiveDiagnosticResult,
    line: number,
    col: number,
    styleAttr: StyleAttrData | null,
  ): Diagnostic {
    const data: DiagnosticData = {
      ruleId: result.ruleId,
      styleAttr,
      fixContext: result.fixContext,
    };

    return {
      range: {
        start: { line, character: col },
        end: { line, character: col + 1 },
      },
      message: result.message,
      severity: result.severity,
      source: 'ui-ls-live',
      data,
    };
  }
}
