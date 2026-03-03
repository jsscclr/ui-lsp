import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeResult,
  type Diagnostic,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { resolve } from 'node:path';
import {
  ConnectionStatusMethod,
  CursorPositionMethod,
  InspectorDataMethod,
  StyleEditMethod,
  DEFAULT_CHROME_DEBUG_PORT,
} from '@ui-ls/shared';
import type { CursorPositionParams, StyleEditParams, StyleEditResult } from '@ui-ls/shared';
import { CDPConnection } from './cdp/cdp-connection.js';
import { SourceMapper } from './source-mapping/source-mapper.js';
import { JsxAnalyzer } from './static/jsx-analyzer.js';
import { HoverProvider } from './hover/hover-provider.js';
import { CodeLensProvider } from './codelens/codelens-provider.js';
import { InlayHintProvider } from './inlay-hints/inlay-hint-provider.js';
import { ColorProvider } from './color/color-provider.js';
import { DiagnosticsProvider } from './diagnostics/diagnostics-provider.js';
import { InspectorProvider } from './inspector/inspector-provider.js';
import { CodeActionProvider } from './code-actions/code-action-provider.js';
import { LiveDiagnosticsProvider } from './diagnostics/live-diagnostics-provider.js';
import { CompletionProvider } from './completions/completion-provider.js';
import { TokenLoader } from './tokens/token-loader.js';
import { computeStyleEdit } from './inspector/style-edit-handler.js';

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
let liveDiagnosticsProvider: LiveDiagnosticsProvider;
const colorProvider = new ColorProvider(jsxAnalyzer);
const diagnosticsProvider = new DiagnosticsProvider(jsxAnalyzer);
const codeActionProvider = new CodeActionProvider();
const completionProvider = new CompletionProvider(jsxAnalyzer);
let tokenLoader: TokenLoader | null = null;

// Per-URI live diagnostics cache, merged with static on each publish
const liveDiagnosticsCache = new Map<string, Diagnostic[]>();
const liveValidateTimers = new Map<string, ReturnType<typeof setTimeout>>();
const LIVE_VALIDATE_DEBOUNCE = 2_000;

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
  liveDiagnosticsProvider = new LiveDiagnosticsProvider(
    jsxAnalyzer,
    sourceMapper,
    () => cdpConnection,
  );

  // Cursor-scoped live diagnostics: piggyback on InspectorProvider's lookup
  inspectorProvider.onLiveData = (event) => {
    const liveDiags = liveDiagnosticsProvider.diagnosticsForElement(
      event.uri, event.line, event.column,
      event.boxModel, event.computedStyles,
    );
    liveDiagnosticsCache.set(event.uri, liveDiags);
    publishMergedDiagnostics(event.uri);
  };
}

connection.onInitialize((params): InitializeResult => {
  const settings = params.initializationOptions as {
    chromeDebugPort?: number;
    autoConnect?: boolean;
    tokensPath?: string;
    tokens?: { diagnostics?: boolean; completions?: boolean };
  } | undefined;

  const port = settings?.chromeDebugPort ?? DEFAULT_CHROME_DEBUG_PORT;
  const autoConnect = settings?.autoConnect ?? true;

  // Resolve tokensPath relative to workspace root
  const rootUri = params.rootUri ?? params.rootPath;
  const workspaceRoot = rootUri?.startsWith('file://') ? decodeURIComponent(rootUri.slice(7)) : rootUri;
  let tokensPath = settings?.tokensPath;
  if (tokensPath && workspaceRoot && !tokensPath.startsWith('/')) {
    tokensPath = resolve(workspaceRoot, tokensPath);
  }

  cdpConnection = new CDPConnection(port);
  createProviders(cdpConnection);

  // Forward connection state changes as custom notifications
  cdpConnection.onStateChange((state, error) => {
    connection.sendNotification(ConnectionStatusMethod, { state, port, error });

    // On disconnect, clear live diagnostics and re-publish static-only
    if (state === 'disconnected') {
      for (const [uri] of liveDiagnosticsCache) {
        liveDiagnosticsCache.delete(uri);
        publishMergedDiagnostics(uri);
      }
    }
  });

  // Auto-connect to Chrome if configured
  if (autoConnect) {
    cdpConnection.connect().catch(() => {
      // Silent — connection status notification already sent
    });
  }

  // Load design tokens if configured
  if (tokensPath) {
    tokenLoader = new TokenLoader(tokensPath, () => {
      // On token file reload: update providers and re-publish diagnostics
      diagnosticsProvider.setTokenStore(tokenLoader!.store);
      completionProvider.setTokenStore(tokenLoader!.store);
      inspectorProvider.setTokenStore(tokenLoader!.store);
      for (const uri of documents.keys()) {
        publishMergedDiagnostics(uri);
      }
    });

    tokenLoader.load().then(() => {
      diagnosticsProvider.setTokenStore(tokenLoader!.store);
      completionProvider.setTokenStore(tokenLoader!.store);
      inspectorProvider.setTokenStore(tokenLoader!.store);
      tokenLoader!.startWatching();
      // Re-publish diagnostics for any already-open documents
      for (const uri of documents.keys()) {
        publishMergedDiagnostics(uri);
      }
    }).catch(() => {
      // Token file not found or invalid — continue without tokens
    });
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
      codeLensProvider: { resolveProvider: true },
      inlayHintProvider: {},
      colorProvider: true,
      codeActionProvider: { codeActionKinds: ['quickfix'] },
      completionProvider: { triggerCharacters: ["'", '"'] },
    },
  };
});

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}

function publishMergedDiagnostics(uri: string): void {
  const filePath = uriToPath(uri);
  const staticDiags = diagnosticsProvider.validate(uri, filePath);
  const liveDiags = liveDiagnosticsCache.get(uri) ?? [];
  connection.sendDiagnostics({ uri, diagnostics: [...staticDiags, ...liveDiags] });
}

function scheduleLiveValidation(uri: string): void {
  const existing = liveValidateTimers.get(uri);
  if (existing) clearTimeout(existing);

  liveValidateTimers.set(uri, setTimeout(async () => {
    liveValidateTimers.delete(uri);
    const filePath = uriToPath(uri);
    try {
      const liveDiags = await liveDiagnosticsProvider.validateFile(uri, filePath);
      liveDiagnosticsCache.set(uri, liveDiags);
      publishMergedDiagnostics(uri);
    } catch {
      // CDP unavailable — keep whatever we had
    }
  }, LIVE_VALIDATE_DEBOUNCE));
}

function updateDocument(uri: string, content: string): void {
  const filePath = uriToPath(uri);
  jsxAnalyzer.updateFile(filePath, content);
  hoverProvider.invalidate(filePath);

  // Publish static diagnostics immediately (merged with any cached live)
  publishMergedDiagnostics(uri);

  // Schedule debounced live validation
  scheduleLiveValidation(uri);
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
  const uri = params.textDocument.uri;
  documents.delete(uri);
  jsxAnalyzer.removeFile(uriToPath(uri));
  liveDiagnosticsCache.delete(uri);
  const timer = liveValidateTimers.get(uri);
  if (timer) { clearTimeout(timer); liveValidateTimers.delete(uri); }
  connection.sendDiagnostics({ uri, diagnostics: [] });
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

connection.onCodeAction((params) => {
  return codeActionProvider.onCodeAction(params);
});

connection.onCompletion((params) => {
  return completionProvider.onCompletion(params);
});

// Custom notification: cursor position from the extension
connection.onNotification(CursorPositionMethod, (params: CursorPositionParams) => {
  inspectorProvider.onCursorPosition(params);
});

// Custom request: edit an inline style property from the inspector webview
connection.onRequest(StyleEditMethod, (params: StyleEditParams): StyleEditResult => {
  const edit = computeStyleEdit(
    jsxAnalyzer,
    params.uri,
    params.line,
    params.character,
    params.propName,
    params.value,
  );

  if (!edit) {
    return { applied: false, error: 'No style attribute found at cursor position' };
  }

  // Return the TextEdit — the extension applies it via workspace.applyEdit
  return { applied: true, edit };
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
  tokenLoader?.stopWatching();
});

connection.listen();
