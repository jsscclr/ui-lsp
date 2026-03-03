import * as vscode from 'vscode';

/**
 * Discover the Chrome debug port.
 * Priority: VS Code setting → probe default port.
 */
export async function discoverChromePort(): Promise<number | null> {
  const config = vscode.workspace.getConfiguration('uiLanguageServer');
  const configuredPort = config.get<number>('chromeDebugPort', 9222);

  if (await probePort(configuredPort)) {
    return configuredPort;
  }

  return null;
}

async function probePort(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/json/version`);
    return resp.ok;
  } catch {
    return false;
  }
}
