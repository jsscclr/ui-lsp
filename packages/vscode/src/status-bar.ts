import * as vscode from 'vscode';
import type { ConnectionStatusNotification } from '@ui-ls/shared';

const STATE_ICONS: Record<string, string> = {
  disconnected: '$(debug-disconnect)',
  connecting: '$(loading~spin)',
  connected: '$(check)',
  reconnecting: '$(loading~spin)',
};

const STATE_LABELS: Record<string, string> = {
  disconnected: 'UI LS: Disconnected',
  connecting: 'UI LS: Connecting...',
  connected: 'UI LS: Connected',
  reconnecting: 'UI LS: Reconnecting...',
};

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'uiLanguageServer.showStatus';
    this.updateState('disconnected');
    this.item.show();
  }

  updateState(state: ConnectionStatusNotification['state']): void {
    const icon = STATE_ICONS[state] ?? '';
    const label = STATE_LABELS[state] ?? 'UI LS: Unknown';
    this.item.text = `${icon} ${label}`;

    if (state === 'connected') {
      this.item.backgroundColor = undefined;
    } else if (state === 'disconnected') {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
