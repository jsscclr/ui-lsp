import {
  DEFAULT_CHROME_DEBUG_PORT,
  DEFAULT_RECONNECT_INTERVAL_MS,
  MAX_RECONNECT_INTERVAL_MS,
  RECONNECT_BACKOFF_MULTIPLIER,
} from '@ui-ls/shared';
import { CDPClient } from './cdp-client.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
type StateChangeHandler = (state: ConnectionState, error?: string) => void;

interface DebuggerTarget {
  webSocketDebuggerUrl?: string;
  type: string;
  title: string;
}

/**
 * Manages CDP connection lifecycle:
 *   Disconnected → Connecting → Connected → Reconnecting → ...
 *
 * Discovers the WS debugger URL via Chrome's /json endpoint,
 * enables required domains, and handles reconnection with exponential backoff.
 */
export class CDPConnection {
  private client: CDPClient | null = null;
  private state: ConnectionState = 'disconnected';
  private stateHandlers = new Set<StateChangeHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInterval = DEFAULT_RECONNECT_INTERVAL_MS;
  private shouldReconnect = false;
  private port: number;

  constructor(port = DEFAULT_CHROME_DEBUG_PORT) {
    this.port = port;
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  get cdpClient(): CDPClient | null {
    return this.state === 'connected' ? this.client : null;
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    await this.attemptConnection();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.client) {
      this.client.dispose();
      this.client = null;
    }
    this.setState('disconnected');
  }

  private async attemptConnection(): Promise<void> {
    this.setState(this.state === 'disconnected' ? 'connecting' : 'reconnecting');

    try {
      const wsUrl = await this.discoverWsUrl();
      const client = new CDPClient();
      await client.connect(wsUrl);

      // Enable required CDP domains
      await client.send('DOM.enable');
      await client.send('CSS.enable');
      await client.send('Runtime.enable');

      this.client = client;
      this.reconnectInterval = DEFAULT_RECONNECT_INTERVAL_MS;
      this.setState('connected');

      // Handle unexpected close
      client.on('Inspector.detached', () => this.handleDisconnect());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState(this.state, message);
      this.scheduleReconnect();
    }
  }

  private handleDisconnect(): void {
    if (this.client) {
      this.client.dispose();
      this.client = null;
    }
    if (this.shouldReconnect) {
      this.scheduleReconnect();
    } else {
      this.setState('disconnected');
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.clearReconnectTimer();
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectInterval = Math.min(
        this.reconnectInterval * RECONNECT_BACKOFF_MULTIPLIER,
        MAX_RECONNECT_INTERVAL_MS,
      );
      this.attemptConnection();
    }, this.reconnectInterval);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(newState: ConnectionState, error?: string): void {
    this.state = newState;
    for (const handler of this.stateHandlers) {
      handler(newState, error);
    }
  }

  private async discoverWsUrl(): Promise<string> {
    const url = `http://localhost:${this.port}/json`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Chrome debug endpoint returned ${resp.status}`);
    }
    const targets = (await resp.json()) as DebuggerTarget[];
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) {
      throw new Error('No debuggable page target found');
    }
    return page.webSocketDebuggerUrl;
  }
}
