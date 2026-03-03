import type { CDPClient } from './cdp-client.js';

export interface OverflowData {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * Read scroll/client dimensions from a DOM element via its objectId.
 * Uses Runtime.callFunctionOn so `this` is bound to the element.
 */
export async function queryOverflow(
  client: CDPClient,
  objectId: string,
): Promise<OverflowData | null> {
  try {
    const result = (await client.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        return {
          scrollWidth: this.scrollWidth,
          scrollHeight: this.scrollHeight,
          clientWidth: this.clientWidth,
          clientHeight: this.clientHeight,
        };
      }`,
      returnByValue: true,
      awaitPromise: false,
    })) as { result: { value?: OverflowData }; exceptionDetails?: unknown };

    if (result.exceptionDetails || !result.result.value) return null;
    return result.result.value;
  } catch {
    return null;
  }
}
