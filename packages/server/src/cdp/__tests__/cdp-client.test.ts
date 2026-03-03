import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CDPClient } from '../cdp-client.js';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';

let wss: WebSocketServer;
let serverSocket: WsSocket;
let port: number;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 });
    port = (wss.address() as { port: number }).port;
    wss.on('connection', (ws) => {
      serverSocket = ws;
    });
    wss.on('listening', resolve);
  });
}

beforeEach(async () => {
  await startServer();
});

afterEach(() => {
  wss.close();
});

describe('CDPClient', () => {
  it('connects to a WebSocket server', async () => {
    const client = new CDPClient();
    await client.connect(`ws://localhost:${port}`);
    expect(client.connected).toBe(true);
    client.dispose();
  });

  it('sends a request and receives a response', async () => {
    const client = new CDPClient();
    await client.connect(`ws://localhost:${port}`);

    // Server echoes back a result when it gets a message
    serverSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      serverSocket.send(JSON.stringify({ id: msg.id, result: { enabled: true } }));
    });

    const result = await client.send<{ enabled: boolean }>('DOM.enable');
    expect(result).toEqual({ enabled: true });
    client.dispose();
  });

  it('rejects on CDP error response', async () => {
    const client = new CDPClient();
    await client.connect(`ws://localhost:${port}`);

    serverSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      serverSocket.send(
        JSON.stringify({ id: msg.id, error: { code: -32000, message: 'Node not found' } }),
      );
    });

    await expect(client.send('DOM.getBoxModel', { nodeId: 999 })).rejects.toThrow(
      'CDP error -32000: Node not found',
    );
    client.dispose();
  });

  it('dispatches events to subscribed handlers', async () => {
    const client = new CDPClient();
    await client.connect(`ws://localhost:${port}`);

    const handler = vi.fn();
    client.on('DOM.documentUpdated', handler);

    // Wait for the server socket to be ready
    await vi.waitFor(() => expect(serverSocket).toBeDefined());

    serverSocket.send(JSON.stringify({ method: 'DOM.documentUpdated', params: {} }));

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({}));
    client.dispose();
  });

  it('unsubscribes event handlers', async () => {
    const client = new CDPClient();
    await client.connect(`ws://localhost:${port}`);

    const handler = vi.fn();
    const unsub = client.on('DOM.documentUpdated', handler);
    unsub();

    await vi.waitFor(() => expect(serverSocket).toBeDefined());
    serverSocket.send(JSON.stringify({ method: 'DOM.documentUpdated', params: {} }));

    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 50));
    expect(handler).not.toHaveBeenCalled();
    client.dispose();
  });

  it('rejects pending requests on close', async () => {
    const client = new CDPClient();
    await client.connect(`ws://localhost:${port}`);

    const pending = client.send('DOM.enable');
    client.dispose();

    await expect(pending).rejects.toThrow('Client disposed');
  });

  it('throws when sending without connection', async () => {
    const client = new CDPClient();
    await expect(client.send('DOM.enable')).rejects.toThrow('Not connected');
  });
});
