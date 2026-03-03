import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node.js';
import { discoverChromePort } from './chrome-discovery.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: LanguageClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('uiLanguageServer.connect', async () => {
      const port = await discoverChromePort();
      if (port === null) {
        const input = await vscode.window.showInputBox({
          prompt: 'Chrome debug port',
          value: '9222',
        });
        if (!input) return;
        const customPort = parseInt(input, 10);
        if (Number.isNaN(customPort)) {
          vscode.window.showErrorMessage('Invalid port number');
          return;
        }
        await client.sendRequest('ui-ls/connect', { port: customPort });
      } else {
        await client.sendRequest('ui-ls/connect', { port });
      }
    }),

    vscode.commands.registerCommand('uiLanguageServer.disconnect', async () => {
      await client.sendRequest('ui-ls/disconnect');
    }),

    vscode.commands.registerCommand('uiLanguageServer.showStatus', () => {
      vscode.window.showInformationMessage(
        'UI Language Server provides live layout and style inspection for React components. ' +
        'Start Chrome with --remote-debugging-port=9222 for live data.',
      );
    }),
  );
}
