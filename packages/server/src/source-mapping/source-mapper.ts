import type { BoxModelData, ComputedStyles, ComponentInfo, LiveHoverData } from '@ui-ls/shared';
import type { CDPClient } from '../cdp/cdp-client.js';
import { getRawBoxModel, getBoxModel, getComputedStyle, requestNodeForObject, getDocument, captureElementScreenshot, captureElementHtml, parseBoxModel } from '../cdp/cdp-domains.js';
import { buildFiberLookupExpression, parseFiberLookupResult } from '../cdp/fiber-bridge.js';
import { FiberCache } from './fiber-cache.js';

interface FiberResult {
  objectId: string;
  props: Record<string, unknown>;
  componentName: string;
}

/**
 * Orchestrates source location → live DOM data:
 *   1. file:line:col → fiber-bridge Runtime.evaluate → finds React fiber
 *   2. fiber's DOM element objectId → DOM.requestNode → nodeId
 *   3. nodeId → DOM.getBoxModel + CSS.getComputedStyle
 */
export class SourceMapper {
  private fiberCache = new FiberCache<FiberResult>(100, 5_000);
  private lookupCounter = 0;

  async lookupLive(
    client: CDPClient,
    filePath: string,
    line: number,
    column: number,
    expectedName?: string,
  ): Promise<LiveHoverData | null> {
    const cacheKey = FiberCache.makeKey(filePath, line, column);

    let fiber: FiberResult | undefined = this.fiberCache.get(cacheKey);
    if (!fiber) {
      const found = await this.findFiber(client, filePath, line, column, expectedName);
      if (!found) return null;
      fiber = found;
      this.fiberCache.set(cacheKey, fiber);
    }

    // Ensure DOM tree is available
    await getDocument(client);

    const nodeId = await requestNodeForObject(client, fiber.objectId);
    if (!nodeId) return null;

    // Fetch raw box model + computed styles in parallel (one CDP call each)
    const [rawModel, computedStyles] = await Promise.all([
      getRawBoxModel(client, nodeId),
      getComputedStyle(client, nodeId),
    ]);

    // Parse box model (sync) and capture screenshot + HTML snapshot (async) in parallel
    const boxModel = parseBoxModel(rawModel);
    const [screenshot, renderedHtml] = await Promise.all([
      captureElementScreenshot(client, rawModel),
      captureElementHtml(client, fiber.objectId),
    ]);

    const componentInfo: ComponentInfo = {
      name: fiber.componentName,
      filePath,
      line,
      column,
      props: fiber.props,
    };

    return {
      source: 'live',
      componentInfo,
      boxModel,
      computedStyles,
      ...(screenshot ? { screenshot } : {}),
      ...(renderedHtml ? { renderedHtml } : {}),
    };
  }

  invalidateCache(): void {
    this.fiberCache.invalidate();
  }

  private async findFiber(
    client: CDPClient,
    filePath: string,
    line: number,
    column: number,
    expectedName?: string,
  ): Promise<FiberResult | null> {
    // Unique ID prevents concurrent lookups from clobbering each other's stored elements
    const lookupId = String(++this.lookupCounter);
    const elKey = `__UI_LS_EL_${lookupId}__`;
    const expression = buildFiberLookupExpression(filePath, line, column, lookupId, expectedName);

    // Get by-value result (props, componentName, found)
    // The expression is async (fetches source maps for React 19), so awaitPromise: true
    const byValueResult = (await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value?: unknown }; exceptionDetails?: unknown };

    if (byValueResult.exceptionDetails) return null;

    const parsed = parseFiberLookupResult(byValueResult.result.value);
    if (!parsed.found) return null;

    // Get the DOM element's objectId from the unique global set by the lookup expression
    const elementResult = (await client.send('Runtime.evaluate', {
      expression: `window['${elKey}']`,
      returnByValue: false,
      awaitPromise: false,
    })) as { result: { objectId?: string; type: string; subtype?: string } };

    // Clean up the global
    client.send('Runtime.evaluate', {
      expression: `delete window['${elKey}']`,
      returnByValue: true,
      awaitPromise: false,
    }).catch(() => {});

    if (!elementResult.result.objectId) return null;

    return {
      objectId: elementResult.result.objectId,
      props: parsed.props ?? {},
      componentName: parsed.componentName ?? 'Unknown',
    };
  }
}
