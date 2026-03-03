import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node.js';
import { CursorPositionMethod, StyleEditMethod } from '@ui-ls/shared';
import type { InspectorData, StyleEditParams, StyleEditResult } from '@ui-ls/shared';

/**
 * WebviewViewProvider for the Component Inspector sidebar panel.
 * Receives InspectorData from the extension and relays it to the webview.
 * Handles edit messages from the webview and forwards them to the server.
 */
export class InspectorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'uiLanguageServer.inspectorView';

  private view?: vscode.WebviewView;
  private client?: LanguageClient;
  private lastData?: InspectorData | null;

  constructor(private extensionUri: vscode.Uri) {}

  /** Set the language client after it starts (needed for LSP requests). */
  setClient(client: LanguageClient): void {
    this.client = client;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    const cssUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'inspector.css'),
    );
    const jsUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'inspector.js'),
    );

    webviewView.webview.html = this.getHtml(cssUri, jsUri);

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  updateData(data: InspectorData | null): void {
    this.lastData = data;
    this.view?.webview.postMessage({ type: 'update', data });
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'jumpToProperty':
        await this.handleJumpToProperty(message as {
          type: string;
          filePath: string;
          range: { start: { line: number; character: number } };
        });
        break;
      case 'editStyle':
        await this.handleEditStyle(message as {
          type: string;
          propName: string;
          value: string;
        });
        break;
    }
  }

  private async handleJumpToProperty(message: {
    filePath: string;
    range: { start: { line: number; character: number } };
  }): Promise<void> {
    const uri = vscode.Uri.file(message.filePath);
    const pos = new vscode.Position(message.range.start.line, message.range.start.character);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(pos, pos),
    });
  }

  private async handleEditStyle(message: {
    propName: string;
    value: string;
  }): Promise<void> {
    if (!this.client || !this.lastData) return;

    const params: StyleEditParams = {
      uri: `file://${this.lastData.filePath}`,
      line: this.lastData.line,
      character: this.lastData.column,
      propName: message.propName,
      value: message.value,
    };

    const result = await this.client.sendRequest<StyleEditResult>(StyleEditMethod, params);

    if (result.applied && result.edit) {
      const uri = vscode.Uri.file(this.lastData.filePath);
      const wsEdit = new vscode.WorkspaceEdit();
      const range = new vscode.Range(
        new vscode.Position(result.edit.range.start.line, result.edit.range.start.character),
        new vscode.Position(result.edit.range.end.line, result.edit.range.end.character),
      );
      wsEdit.replace(uri, range, result.edit.newText);
      await vscode.workspace.applyEdit(wsEdit);

      // Re-send cursor position to refresh the inspector with updated data
      this.client.sendNotification(CursorPositionMethod, {
        uri: params.uri,
        line: params.line,
        character: params.character,
      });
    }
  }

  private getHtml(cssUri: vscode.Uri, jsUri: vscode.Uri): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="inspector">
    <div id="placeholder">Move cursor to a JSX element</div>
    <div id="content" hidden>
      <div id="header">
        <span id="component-name"></span>
        <span id="source-badge"></span>
      </div>
      <div id="preview-section" hidden>
        <div id="preview-container"><div id="preview-content"></div></div>
      </div>
      <div id="screenshot-section" hidden>
        <img id="screenshot" alt="Element screenshot">
      </div>
      <div id="box-model-section" hidden>
        <h3>Box Model</h3>
        <div id="box-model"></div>
      </div>
      <div id="styles-section" hidden>
        <h3>Computed Styles</h3>
        <table id="styles-table"></table>
      </div>
      <div id="props-section" hidden>
        <h3>Props</h3>
        <pre id="props"></pre>
      </div>
    </div>
  </div>
  <script src="${jsUri}"></script>
</body>
</html>`;
  }
}
