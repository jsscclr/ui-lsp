import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node.js';
import { CursorPositionMethod } from '@ui-ls/shared';

/**
 * Tracks editor cursor position and sends debounced notifications
 * to the language server for the Component Inspector.
 */
export class CursorTracker implements vscode.Disposable {
  private disposable: vscode.Disposable;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private client: LanguageClient) {
    this.disposable = vscode.window.onDidChangeTextEditorSelection((e) => {
      this.onSelectionChange(e);
    });
  }

  private onSelectionChange(e: vscode.TextEditorSelectionChangeEvent): void {
    const doc = e.textEditor.document;

    // Only track .tsx and .jsx files
    if (doc.languageId !== 'typescriptreact' && doc.languageId !== 'javascriptreact') {
      return;
    }

    const pos = e.selections[0].active;

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.client.sendNotification(CursorPositionMethod, {
        uri: doc.uri.toString(),
        line: pos.line,
        character: pos.character,
      });
    }, 150);
  }

  dispose(): void {
    clearTimeout(this.debounceTimer);
    this.disposable.dispose();
  }
}
