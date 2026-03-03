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
