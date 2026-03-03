import * as vscode from 'vscode';
import type { InspectorData } from '@ui-ls/shared';

/**
 * WebviewViewProvider for the Component Inspector sidebar panel.
 * Receives InspectorData from the extension and relays it to the webview.
 */
export class InspectorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'uiLanguageServer.inspectorView';

  private view?: vscode.WebviewView;

  constructor(private extensionUri: vscode.Uri) {}

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

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  updateData(data: InspectorData | null): void {
    this.view?.webview.postMessage({ type: 'update', data });
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
