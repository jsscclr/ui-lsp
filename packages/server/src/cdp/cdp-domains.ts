import type { CDPBoxModel, CDPComputedStyleProperty, CDPRemoteObject, BoxModelData, ComputedStyles } from '@ui-ls/shared';
import type { CDPClient } from './cdp-client.js';

/** Convert CDP's flat 8-element quad arrays into structured box model data. */
function parseBoxModel(raw: CDPBoxModel): BoxModelData {
  const contentWidth = raw.width;
  const contentHeight = raw.height;

  // CDP quads are [x1,y1, x2,y2, x3,y3, x4,y4] — clockwise from top-left.
  // Content box origin
  const cx = raw.content[0];
  const cy = raw.content[1];

  return {
    content: { x: cx, y: cy, width: contentWidth, height: contentHeight },
    padding: {
      top: raw.content[1] - raw.padding[1],
      right: raw.padding[2] - raw.content[2],
      bottom: raw.padding[5] - raw.content[5],
      left: raw.content[0] - raw.padding[0],
    },
    border: {
      top: raw.padding[1] - raw.border[1],
      right: raw.border[2] - raw.padding[2],
      bottom: raw.border[5] - raw.padding[5],
      left: raw.padding[0] - raw.border[0],
    },
    margin: {
      top: raw.border[1] - raw.margin[1],
      right: raw.margin[2] - raw.border[2],
      bottom: raw.margin[5] - raw.border[5],
      left: raw.border[0] - raw.margin[0],
    },
  };
}

export async function getBoxModel(client: CDPClient, nodeId: number): Promise<BoxModelData> {
  const result = (await client.send('DOM.getBoxModel', { nodeId })) as { model: CDPBoxModel };
  return parseBoxModel(result.model);
}

export async function getComputedStyle(
  client: CDPClient,
  nodeId: number,
): Promise<ComputedStyles> {
  const result = (await client.send('CSS.getComputedStyleForNode', { nodeId })) as {
    computedStyle: CDPComputedStyleProperty[];
  };
  const styles: ComputedStyles = {};
  for (const { name, value } of result.computedStyle) {
    styles[name] = value;
  }
  return styles;
}

export async function evaluateOnPage<T = unknown>(
  client: CDPClient,
  expression: string,
): Promise<T> {
  const result = (await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  })) as { result: CDPRemoteObject; exceptionDetails?: unknown };

  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result.value as T;
}

export async function evaluateOnPageForObject(
  client: CDPClient,
  expression: string,
): Promise<CDPRemoteObject> {
  const result = (await client.send('Runtime.evaluate', {
    expression,
    returnByValue: false,
    awaitPromise: false,
  })) as { result: CDPRemoteObject; exceptionDetails?: unknown };

  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result;
}

export async function requestNodeForObject(
  client: CDPClient,
  objectId: string,
): Promise<number> {
  const result = (await client.send('DOM.requestNode', { objectId })) as { nodeId: number };
  return result.nodeId;
}

export async function getDocument(client: CDPClient): Promise<number> {
  const result = (await client.send('DOM.getDocument', { depth: 0 })) as {
    root: { nodeId: number };
  };
  return result.root.nodeId;
}
