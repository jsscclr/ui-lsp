import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  ConnectionStatusMethod,
  CursorPositionMethod,
  InspectorDataMethod,
  DEFAULT_CHROME_DEBUG_PORT,
} from '@ui-ls/shared';
import type { CursorPositionParams } from '@ui-ls/shared';
import { CDPConnection } from './cdp/cdp-connection.js';
import { SourceMapper } from './source-mapping/source-mapper.js';
import { JsxAnalyzer } from './static/jsx-analyzer.js';
import { HoverProvider } from './hover/hover-provider.js';
import { CodeLensProvider } from './codelens/codelens-provider.js';
import { InlayHintProvider } from './inlay-hints/inlay-hint-provider.js';
import { ColorProvider } from './color/color-provider.js';
import { DiagnosticsProvider } from './diagnostics/diagnostics-provider.js';
import { InspectorProvider } from './inspector/inspector-provider.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new Map<string, TextDocument>();

// Shared analyzer instance — all providers read from the same in-memory AST
const jsxAnalyzer = new JsxAnalyzer();

let cdpConnection: CDPConnection;
let sourceMapper: SourceMapper;
let hoverProvider: HoverProvider;
let codeLensProvider: CodeLensProvider;
let inlayHintProvider: InlayHintProvider;
let inspectorProvider: InspectorProvider;
const colorProvider = new ColorProvider(jsxAnalyzer);
const diagnosticsProvider = new DiagnosticsProvider(jsxAnalyzer);

function createProviders(cdp: CDPConnection): void {
  sourceMapper = new SourceMapper();
  hoverProvider = new HoverProvider(jsxAnalyzer, cdp, sourceMapper);
  codeLensProvider = new CodeLensProvider(jsxAnalyzer, cdp);
  inlayHintProvider = new InlayHintProvider(jsxAnalyzer, cdp);
  inspectorProvider = new InspectorProvider(
    jsxAnalyzer,
    sourceMapper,
    () => cdpConnection,
    (data) => connection.sendNotification(InspectorDataMethod, data),
  );
}

connection.onInitialize((params): InitializeResult => {
  const settings = params.initializationOptions as {
    chromeDebugPort?: number;
    autoConnect?: boolean;
  } | undefined;

  const port = settings?.chromeDebugPort ?? DEFAULT_CHROME_DEBUG_PORT;
  const autoConnect = settings?.autoConnect ?? true;

  cdpConnection = new CDPConnection(port);
  createProviders(cdpConnection);

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
      codeLensProvider: { resolveProvider: true },
      inlayHintProvider: {},
      colorProvider: true,
    },
  };
});

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}

function updateDocument(uri: string, content: string): void {
  const filePath = uriToPath(uri);
  jsxAnalyzer.updateFile(filePath, content);
  hoverProvider.invalidate(filePath);

  // Push diagnostics for style issues
  const diagnostics = diagnosticsProvider.validate(uri, filePath);
  connection.sendDiagnostics({ uri, diagnostics });
}

connection.onDidOpenTextDocument((params) => {
  const doc = TextDocument.create(
    params.textDocument.uri,
    params.textDocument.languageId,
    params.textDocument.version,
    params.textDocument.text,
  );
  documents.set(params.textDocument.uri, doc);
  updateDocument(params.textDocument.uri, params.textDocument.text);
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
    updateDocument(params.textDocument.uri, params.contentChanges[0].text);
  }
});

connection.onDidCloseTextDocument((params) => {
  documents.delete(params.textDocument.uri);
  jsxAnalyzer.removeFile(uriToPath(params.textDocument.uri));
  connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics: [] });
});

connection.onHover((params) => {
  return hoverProvider.onHover(params, (uri) => documents.get(uri));
});

connection.onCodeLens((params) => {
  return codeLensProvider.onCodeLens(params);
});

connection.onCodeLensResolve((lens) => {
  return codeLensProvider.onCodeLensResolve(lens);
});

connection.languages.inlayHint.on((params) => {
  return inlayHintProvider.onInlayHint(params);
});

connection.onDocumentColor((params) => {
  return colorProvider.onDocumentColor(params);
});

connection.onColorPresentation((params) => {
  return colorProvider.onColorPresentation(params);
});

// Custom notification: cursor position from the extension
connection.onNotification(CursorPositionMethod, (params: CursorPositionParams) => {
  inspectorProvider.onCursorPosition(params);
});

// Custom requests for connect/disconnect commands
connection.onRequest('ui-ls/connect', async (params: { port?: number }) => {
  const port = params?.port ?? DEFAULT_CHROME_DEBUG_PORT;
  cdpConnection.disconnect();
  cdpConnection = new CDPConnection(port);
  createProviders(cdpConnection);
  cdpConnection.onStateChange((state, error) => {
    connection.sendNotification(ConnectionStatusMethod, { state, port, error });
  });
  await cdpConnection.connect();
});

connection.onRequest('ui-ls/disconnect', () => {
  cdpConnection.disconnect();
});

connection.onRequest('ui-ls/diagnose', async () => {
  const client = cdpConnection.cdpClient;
  if (!client) return { error: 'not connected' };
  try {
    const { buildFiberDiagnosticExpression, buildFiberLookupExpression } = await import('./cdp/fiber-bridge.js');

    // Run standard diagnostic
    const diagResult = await client.send('Runtime.evaluate', {
      expression: buildFiberDiagnosticExpression(),
      returnByValue: true,
      awaitPromise: false,
    });

    // Test lookup: try to find the div at line 2 (0-based) of App.tsx
    // This exercises the full async source map resolution path
    const testExpr = buildFiberLookupExpression('/src/App.tsx', 2, 0);
    const lookupResult = await client.send('Runtime.evaluate', {
      expression: testExpr,
      returnByValue: true,
      awaitPromise: true,
    }) as { result: { value?: unknown }; exceptionDetails?: unknown };

    return {
      diagnostic: diagResult,
      testLookup: {
        input: { file: '/src/App.tsx', line: 2 },
        result: lookupResult.result?.value,
        exception: lookupResult.exceptionDetails ? String(lookupResult.exceptionDetails) : null,
      },
    };
  } catch (err) {
    return { error: String(err) };
  }
});

connection.onShutdown(() => {
  cdpConnection.disconnect();
});

connection.listen();
