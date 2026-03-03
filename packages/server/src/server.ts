import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ConnectionStatusMethod, DEFAULT_CHROME_DEBUG_PORT } from '@ui-ls/shared';
import { CDPConnection } from './cdp/cdp-connection.js';
import { HoverProvider } from './hover/hover-provider.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new Map<string, TextDocument>();

let cdpConnection: CDPConnection;
let hoverProvider: HoverProvider;

connection.onInitialize((params): InitializeResult => {
  const settings = params.initializationOptions as {
    chromeDebugPort?: number;
    autoConnect?: boolean;
  } | undefined;

  const port = settings?.chromeDebugPort ?? DEFAULT_CHROME_DEBUG_PORT;
  const autoConnect = settings?.autoConnect ?? true;

  cdpConnection = new CDPConnection(port);
  hoverProvider = new HoverProvider(cdpConnection);

  // Forward connection state changes as custom notifications
  cdpConnection.onStateChange((state, error) => {
    connection.sendNotification(ConnectionStatusMethod, { state, port, error });
  });

  // Auto-connect to Chrome if configured
  if (autoConnect) {
    cdpConnection.connect().catch(() => {
      // Silent — connection status notification already sent
    });
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
    },
  };
});

connection.onDidOpenTextDocument((params) => {
  const doc = TextDocument.create(
    params.textDocument.uri,
    params.textDocument.languageId,
    params.textDocument.version,
    params.textDocument.text,
  );
  documents.set(params.textDocument.uri, doc);
  hoverProvider.updateDocument(params.textDocument.uri, params.textDocument.text);
});

connection.onDidChangeTextDocument((params) => {
  const existing = documents.get(params.textDocument.uri);
  if (existing && params.contentChanges.length > 0) {
    // Full sync: the entire content is in contentChanges[0].text
    const doc = TextDocument.create(
      params.textDocument.uri,
      existing.languageId,
      params.textDocument.version,
      params.contentChanges[0].text,
    );
    documents.set(params.textDocument.uri, doc);
    hoverProvider.updateDocument(params.textDocument.uri, params.contentChanges[0].text);
  }
});

connection.onDidCloseTextDocument((params) => {
  documents.delete(params.textDocument.uri);
  hoverProvider.removeDocument(params.textDocument.uri);
});

connection.onHover((params) => {
  return hoverProvider.onHover(params, (uri) => documents.get(uri));
});

// Custom requests for connect/disconnect commands
connection.onRequest('ui-ls/connect', async (params: { port?: number }) => {
  const port = params?.port ?? DEFAULT_CHROME_DEBUG_PORT;
  cdpConnection.disconnect();
  cdpConnection = new CDPConnection(port);
  hoverProvider = new HoverProvider(cdpConnection);
  cdpConnection.onStateChange((state, error) => {
    connection.sendNotification(ConnectionStatusMethod, { state, port, error });
  });
  await cdpConnection.connect();
});

connection.onRequest('ui-ls/disconnect', () => {
  cdpConnection.disconnect();
});

connection.onShutdown(() => {
  cdpConnection.disconnect();
});

connection.listen();
