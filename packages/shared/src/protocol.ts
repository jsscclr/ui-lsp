import type { BoxModelData, ComputedStyles } from './types.js';

/** Custom LSP notification: server → client connection status updates. */
export interface ConnectionStatusNotification {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  port?: number;
  error?: string;
}

/** Request sent via Runtime.evaluate to the browser companion. */
export interface FiberLookupRequest {
  fileName: string;
  line: number;
  column: number;
}

/** Response from the browser companion's fiber lookup. */
export interface FiberLookupResponse {
  found: boolean;
  objectId?: string;
  props?: Record<string, unknown>;
  componentName?: string;
}

export const ConnectionStatusMethod = 'ui-ls/connectionStatus' as const;

/** Client → Server: cursor moved to a new position. */
export interface CursorPositionParams {
  uri: string;
  line: number;
  character: number;
}

export const CursorPositionMethod = 'ui-ls/cursorPosition' as const;

/** Server → Client: inspector data ready for the webview. */
export interface InspectorData {
  componentName: string;
  filePath: string;
  line: number;
  column: number;
  props: Record<string, unknown>;
  boxModel: BoxModelData | null;
  computedStyles: ComputedStyles;
  screenshot: string | null;
  renderedHtml: string | null;
  source: 'live' | 'estimated';
}

export const InspectorDataMethod = 'ui-ls/inspectorData' as const;
