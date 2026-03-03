# Visual Analysis via Claude API

## Summary

Use Claude's vision capability to generate text descriptions of component screenshots and produce subjective UI/UX diagnostic suggestions. The analysis covers visual description, UX issues, design system compliance, and accessibility concerns.

## Architecture

### Approach: Inline in InspectorProvider (Approach A)

The `InspectorProvider` already has the screenshot, computed styles, inline styles, and token matches. After assembling `InspectorData`, it fires an async Claude call. The inspector sends data immediately (no analysis), then re-sends with `visualAnalysis` populated once Claude responds. Stale results are discarded via the existing generation counter.

### Data Flow

```
InspectorProvider.resolveLive()
  → sendData(data)                    // immediate, no AI
  → visualAnalyzer.analyze(...)       // async Claude call
  → check generation (discard if stale)
  → sendData({ ...data, visualAnalysis })  // enriched
  → publish AI diagnostics
```

## Protocol

New optional field on `InspectorData`:

```typescript
visualAnalysis?: {
  description: string;
  suggestions: Array<{
    category: 'ux' | 'accessibility' | 'design-system' | 'visual';
    severity: 'info' | 'warning';
    message: string;
    property?: string;  // camelCase CSS property, if applicable
  }>;
  cached: boolean;
}
```

## Claude API Integration

**Module**: `packages/server/src/ai/visual-analyzer.ts`

- Wraps `@anthropic-ai/sdk`
- Uses Claude Haiku for speed and cost
- System prompt: act as a UI/UX reviewer
- User message: screenshot image block + component name + computed styles + token context
- Response: JSON with `description` + `suggestions` array

**Cache**: In-memory `Map<string, VisualAnalysis>` keyed by hash of `screenshot_base64 + componentName`. 60s TTL, 50-entry LRU cap.

**API key**: `process.env.ANTHROPIC_API_KEY`. If absent, feature is silently disabled.

**Errors**: Network failures, rate limits, malformed responses → return null, no AI section shown. No retries.

## InspectorProvider Integration

- `setVisualAnalyzer(analyzer)` setter pattern (same as `setTokenStore`)
- `resolveLive()`: two-phase send (immediate, then enriched)
- `resolveStatic()`: skipped (no screenshot)
- AI diagnostics: `aiDiagnosticsCache` map merged into `publishMergedDiagnostics`
- Diagnostics use source `'ui-ls-ai'`, created for suggestions that have a `property` mapping to an inline style range

## Webview UI

New "AI Analysis" section between Computed Styles and Props:

- **No API key**: section hidden
- **Loading**: spinner + "Analyzing..."
- **Result**: description paragraph, then suggestion cards with category pills and severity icons
- **Cached**: "(cached)" label on section header
- **Error**: section hidden

Styled with VS Code theme variables. Warning suggestions use `--vscode-inputValidation-warningBackground`, info uses `--vscode-inputValidation-infoBackground`.

## Configuration

Feature gated entirely on `ANTHROPIC_API_KEY` env var. No new VS Code settings.

## Files

| File | Action |
|------|--------|
| `packages/server/src/ai/visual-analyzer.ts` | Create |
| `packages/shared/src/protocol.ts` | Modify — add `visualAnalysis` to `InspectorData` |
| `packages/server/src/inspector/inspector-provider.ts` | Modify — async Claude call, AI diagnostics |
| `packages/server/src/server.ts` | Modify — init `VisualAnalyzer`, merge AI diagnostics |
| `packages/vscode/media/inspector.js` | Modify — AI Analysis section rendering |
| `packages/vscode/media/inspector.css` | Modify — AI section styles |
| `packages/server/package.json` | Modify — add `@anthropic-ai/sdk` |
