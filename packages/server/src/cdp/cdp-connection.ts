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
      await client.send('Page.enable');
      await client.send('DOM.enable');
      await client.send('CSS.enable');
      await client.send('Runtime.enable');

      // Reset page scale factor in case a previous session corrupted it
      // (e.g., Page.captureScreenshot with clip.scale < 1)
      await client.send('Emulation.resetPageScaleFactor').catch(() => {});

      // Inject a minimal React DevTools hook so React registers fiber roots,
      // even if the React DevTools extension isn't installed.
      // This runs before any JS on future page loads.
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: buildHookInjectionScript(),
      });

      // Reload so the hook is present before React initializes.
      // Without this, the page that was already loaded won't have the hook.
      await client.send('Page.reload');

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

/**
 * Minimal __REACT_DEVTOOLS_GLOBAL_HOOK__ that React will register fiber roots with.
 * Must be injected before React initializes. React checks for this on module load
 * and calls hook.inject(renderer) + hook.onCommitFiberRoot(id, root) on each commit.
 */
function buildHookInjectionScript(): string {
  return `(function() {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  var roots = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: function(renderer) {
      var id = roots.size + 1;
      roots.set(id, new Set());
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot: function(id, root) {
      var s = roots.get(id);
      if (s) s.add(root);
    },
    onCommitFiberUnmount: function() {},
    getFiberRoots: function(id) {
      return roots.get(id) || new Set();
    }
  };
})();`;
}
