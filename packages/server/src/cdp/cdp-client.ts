import WebSocket from 'ws';

export interface CDPResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: string };
}

export interface CDPEvent {
  method: string;
  params?: unknown;
}

type EventHandler = (params: unknown) => void;

/**
 * Low-level WebSocket JSON-RPC client for Chrome DevTools Protocol.
 * Sends `{id, method, params}`, resolves on matching `{id, result}`.
 * Supports event subscriptions for CDP domain events.
 */
export class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        this.ws = ws;
        this._connected = true;
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        this._connected = false;
        this.rejectAllPending(new Error('WebSocket closed'));
      });

      ws.on('error', (err: Error) => {
        if (!this._connected) {
          reject(err);
        }
      });
    });
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || !this._connected) {
      throw new Error('Not connected');
    }

    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.ws!.send(message);
    });
  }

  on(method: string, handler: EventHandler): () => void {
    let handlers = this.eventHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => handlers!.delete(handler);
  }

  dispose(): void {
    this._connected = false;
    this.rejectAllPending(new Error('Client disposed'));
    this.eventHandlers.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Response to a request
    if ('id' in msg && typeof msg.id === 'number') {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);

      const error = msg.error as CDPResponse['error'];
      if (error) {
        entry.reject(new Error(`CDP error ${error.code}: ${error.message}`));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    // Event
    if ('method' in msg && typeof msg.method === 'string') {
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          handler(msg.params);
        }
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }
}
