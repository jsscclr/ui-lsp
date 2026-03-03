import * as vscode from 'vscode';
import * as path from 'node:path';
import { LanguageClient, TransportKind, type ServerOptions, type LanguageClientOptions } from 'vscode-languageclient/node.js';
import { ConnectionStatusMethod, InspectorDataMethod } from '@ui-ls/shared';
import type { InspectorData } from '@ui-ls/shared';
import { StatusBar } from './status-bar.js';
import { registerCommands } from './commands.js';
import { CursorTracker } from './cursor-tracker.js';
import { InspectorViewProvider } from './inspector-view.js';

let client: LanguageClient;
let statusBar: StatusBar;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('uiLanguageServer');
  if (!config.get<boolean>('enable', true)) return;

  statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  // The server module is the built output of @ui-ls/server
  const serverModule = context.asAbsolutePath(path.join('..', 'server', 'dist', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'typescriptreact' },
      { scheme: 'file', language: 'javascriptreact' },
    ],
    initializationOptions: {
      chromeDebugPort: config.get<number>('chromeDebugPort', 9222),
      autoConnect: config.get<boolean>('autoConnect', true),
    },
  };

  client = new LanguageClient(
    'uiLanguageServer',
    'UI Language Server',
    serverOptions,
    clientOptions,
  );

  // Listen for connection status notifications from the server
  client.onNotification(ConnectionStatusMethod, (params: { state: string }) => {
    statusBar.updateState(params.state as 'disconnected' | 'connecting' | 'connected' | 'reconnecting');
  });

  // Component Inspector webview
  const inspectorProvider = new InspectorViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(InspectorViewProvider.viewType, inspectorProvider),
  );

  // Relay inspector data from server to webview
  client.onNotification(InspectorDataMethod, (data: InspectorData | null) => {
    inspectorProvider.updateData(data);
  });

  // Track cursor position for the inspector
  const cursorTracker = new CursorTracker(client);
  context.subscriptions.push(cursorTracker);

  registerCommands(context, client);

  await client.start();
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}
