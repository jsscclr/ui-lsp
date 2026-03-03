# Visual Analysis via Claude API — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude-powered visual analysis of component screenshots that surfaces subjective UX, accessibility, and design system suggestions.

**Architecture:** The `InspectorProvider` sends `InspectorData` immediately, then fires an async Claude vision call and re-sends with `visualAnalysis` populated. Suggestions targeting inline style properties also publish as LSP diagnostics. Feature gated on `ANTHROPIC_API_KEY` env var.

**Tech Stack:** `@anthropic-ai/sdk` (Haiku model), ts-morph AST, vscode-languageserver LSP, VS Code webview

---

### Task 1: Protocol types

**Files:**
- Modify: `packages/shared/src/protocol.ts:52-67`
- Modify: `packages/shared/src/index.ts:18-27`

**Step 1: Add `VisualAnalysis` type and `visualAnalysis` field to `InspectorData`**

In `packages/shared/src/protocol.ts`, add before the `InspectorData` interface (before line 52):

```typescript
export interface VisualAnalysisSuggestion {
  category: 'ux' | 'accessibility' | 'design-system' | 'visual';
  severity: 'info' | 'warning';
  message: string;
  /** camelCase CSS property name, if the suggestion targets a specific style */
  property?: string;
}

export interface VisualAnalysis {
  description: string;
  suggestions: VisualAnalysisSuggestion[];
  cached: boolean;
}
```

Then add to the `InspectorData` interface (after `tokenMatches`, before `screenshot`):

```typescript
  /** AI-generated visual description and UX suggestions */
  visualAnalysis?: VisualAnalysis;
```

**Step 2: Export the new types**

In `packages/shared/src/index.ts`, add `VisualAnalysis` and `VisualAnalysisSuggestion` to the protocol type exports:

```typescript
export type {
  ConnectionStatusNotification,
  FiberLookupRequest,
  FiberLookupResponse,
  CursorPositionParams,
  InlineStyleInfo,
  InspectorData,
  StyleEditParams,
  StyleEditResult,
  VisualAnalysis,
  VisualAnalysisSuggestion,
} from './protocol.js';
```

**Step 3: Build shared package**

Run: `pnpm --filter @ui-ls/shared build`
Expected: `✓ built` with no errors.

**Step 4: Commit**

```bash
git add packages/shared/src/protocol.ts packages/shared/src/index.ts
git commit -m "feat: add VisualAnalysis protocol types for AI inspector"
```

---

### Task 2: Install Anthropic SDK

**Files:**
- Modify: `packages/server/package.json`

**Step 1: Add dependency**

Run: `pnpm --filter @ui-ls/server add @anthropic-ai/sdk`

**Step 2: Verify install**

Run: `pnpm --filter @ui-ls/server build`
Expected: Builds successfully (the SDK is used in the next task).

**Step 3: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml
git commit -m "chore: add @anthropic-ai/sdk to server dependencies"
```

---

### Task 3: VisualAnalyzer — tests

**Files:**
- Create: `packages/server/src/ai/__tests__/visual-analyzer.test.ts`

**Step 1: Write tests for the VisualAnalyzer**

The analyzer has three testable behaviors: (1) returns null when no API key, (2) returns cached results for the same screenshot, (3) parses Claude's JSON response into the `VisualAnalysis` shape. We mock the Anthropic SDK at the module level.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VisualAnalysis } from '@ui-ls/shared';

// Mock the SDK before importing
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { VisualAnalyzer } from '../visual-analyzer.js';

const FAKE_SCREENSHOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB';
const FAKE_RESPONSE: VisualAnalysis = {
  description: 'A blue button with white text',
  suggestions: [
    {
      category: 'accessibility',
      severity: 'warning',
      message: 'Color contrast ratio appears below 4.5:1',
      property: 'color',
    },
  ],
  cached: false,
};

describe('VisualAnalyzer', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns null when screenshot is absent', async () => {
    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(null, 'Button', {}, [], null);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Claude with screenshot and returns parsed analysis', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(FAKE_RESPONSE) }],
    });

    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(
      FAKE_SCREENSHOT, 'Button', { color: 'white' }, [], null,
    );

    expect(result).not.toBeNull();
    expect(result!.description).toBe('A blue button with white text');
    expect(result!.suggestions).toHaveLength(1);
    expect(result!.suggestions[0].category).toBe('accessibility');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Verify the image was sent
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toContain('haiku');
    const userMsg = call.messages[0];
    expect(userMsg.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image' }),
      ]),
    );
  });

  it('returns cached result for same screenshot + component', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(FAKE_RESPONSE) }],
    });

    const analyzer = new VisualAnalyzer('test-key');
    await analyzer.analyze(FAKE_SCREENSHOT, 'Button', {}, [], null);
    const cached = await analyzer.analyze(FAKE_SCREENSHOT, 'Button', {}, [], null);

    expect(mockCreate).toHaveBeenCalledTimes(1); // only one API call
    expect(cached!.cached).toBe(true);
  });

  it('returns null on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'));

    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(
      FAKE_SCREENSHOT, 'Button', {}, [], null,
    );
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    });

    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(
      FAKE_SCREENSHOT, 'Button', {}, [], null,
    );
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/ai/__tests__/visual-analyzer.test.ts`
Expected: FAIL — `Cannot find module '../visual-analyzer.js'`

**Step 3: Commit the failing test**

```bash
git add packages/server/src/ai/__tests__/visual-analyzer.test.ts
git commit -m "test: add VisualAnalyzer tests (red)"
```

---

### Task 4: VisualAnalyzer — implementation

**Files:**
- Create: `packages/server/src/ai/visual-analyzer.ts`

**Step 1: Implement the analyzer**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { VisualAnalysis, VisualAnalysisSuggestion, ComputedStyles, InlineStyleInfo } from '@ui-ls/shared';

const MODEL = 'claude-haiku-4-5-20251001';
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 50;

interface CacheEntry {
  result: VisualAnalysis;
  timestamp: number;
}

export class VisualAnalyzer {
  private client: Anthropic;
  private cache = new Map<string, CacheEntry>();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async analyze(
    screenshot: string | null,
    componentName: string,
    computedStyles: ComputedStyles,
    inlineStyles: InlineStyleInfo[],
    tokenMatches: Record<string, string> | null,
  ): Promise<VisualAnalysis | null> {
    if (!screenshot) return null;

    const cacheKey = this.hashKey(screenshot, componentName);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.result, cached: true };
    }

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: screenshot },
            },
            {
              type: 'text',
              text: this.buildUserPrompt(componentName, computedStyles, inlineStyles, tokenMatches),
            },
          ],
        }],
      });

      const text = response.content[0];
      if (text.type !== 'text') return null;

      const parsed = JSON.parse(text.text) as {
        description?: string;
        suggestions?: VisualAnalysisSuggestion[];
      };

      if (typeof parsed.description !== 'string' || !Array.isArray(parsed.suggestions)) {
        return null;
      }

      const result: VisualAnalysis = {
        description: parsed.description,
        suggestions: parsed.suggestions,
        cached: false,
      };

      // Store in cache, evict oldest if full
      if (this.cache.size >= CACHE_MAX_SIZE) {
        const oldest = this.cache.keys().next().value!;
        this.cache.delete(oldest);
      }
      this.cache.set(cacheKey, { result, timestamp: Date.now() });

      return result;
    } catch {
      return null;
    }
  }

  private buildUserPrompt(
    componentName: string,
    computedStyles: ComputedStyles,
    inlineStyles: InlineStyleInfo[],
    tokenMatches: Record<string, string> | null,
  ): string {
    const lines = [`Component: <${componentName}>`];

    const styleEntries = Object.entries(computedStyles);
    if (styleEntries.length > 0) {
      lines.push('', 'Computed styles:');
      for (const [prop, val] of styleEntries) {
        const isInline = inlineStyles.some((s) => s.name === prop);
        lines.push(`  ${prop}: ${val}${isInline ? ' (inline)' : ''}`);
      }
    }

    if (tokenMatches && Object.keys(tokenMatches).length > 0) {
      lines.push('', 'Design token matches:');
      for (const [prop, token] of Object.entries(tokenMatches)) {
        lines.push(`  ${prop} → ${token}`);
      }
    }

    return lines.join('\n');
  }

  private hashKey(screenshot: string, componentName: string): string {
    // Simple hash: first 64 chars of screenshot + component name.
    // Full screenshot comparison would be expensive; prefix is enough
    // because different renders produce different base64 prefixes.
    return `${componentName}:${screenshot.slice(0, 64)}`;
  }
}

const SYSTEM_PROMPT = `You are a UI/UX reviewer for a React component inspector. You receive a screenshot of a single UI component along with its computed CSS styles and design token information.

Respond with a JSON object containing:
1. "description": A brief (1-2 sentence) visual description of the component.
2. "suggestions": An array of actionable suggestions. Each suggestion has:
   - "category": one of "ux", "accessibility", "design-system", "visual"
   - "severity": "info" or "warning"
   - "message": a concise, actionable suggestion
   - "property": (optional) the camelCase CSS property name this suggestion targets

Focus on:
- Accessibility: color contrast, touch target size (< 44px), text legibility
- Design system: values that don't match any design token, inconsistent spacing
- UX: visual hierarchy, readability, interactive affordances
- Visual: alignment issues, overflow, clipping

Keep suggestions specific and actionable. Only include genuine issues — do not pad with generic advice.
Respond with ONLY the JSON object, no markdown fences or extra text.`;
```

**Step 2: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/server/src/ai/__tests__/visual-analyzer.test.ts`
Expected: All 5 tests PASS.

**Step 3: Commit**

```bash
git add packages/server/src/ai/visual-analyzer.ts
git commit -m "feat: implement VisualAnalyzer with Claude Haiku vision"
```

---

### Task 5: Wire into InspectorProvider

**Files:**
- Modify: `packages/server/src/inspector/inspector-provider.ts:1-10,25-44,73-87`

**Step 1: Add import and fields**

At the top of `inspector-provider.ts`, add to existing imports:

```typescript
import type { VisualAnalysis } from '@ui-ls/shared';
import type { VisualAnalyzer } from '../ai/visual-analyzer.js';
```

Add field and setter to the `InspectorProvider` class (after `tokenStore` field on line 29):

```typescript
  private visualAnalyzer: VisualAnalyzer | null = null;
```

After the `setTokenStore` method (after line 43):

```typescript
  setVisualAnalyzer(analyzer: VisualAnalyzer | null): void {
    this.visualAnalyzer = analyzer;
  }
```

**Step 2: Add callback for AI diagnostics**

Add a new callback field (after `onLiveData` on line 32):

```typescript
  /** Optional callback fired when AI analysis completes. */
  onAiAnalysis: ((uri: string, data: InspectorData) => void) | null = null;
```

**Step 3: Modify `resolve()` for two-phase send**

Replace the `.then()` handler in `resolve()` (lines 73-87) with a two-phase approach. The key change: after `sendData(data)`, if a visual analyzer is set and the data has a screenshot, fire an async analysis and re-send.

Replace:

```typescript
    // Try live data first, fall back to static
    this.resolveLive(params.uri, filePath, line, col, componentInfo.name, gen)
      .then((data) => {
        if (this.generation !== gen) return; // stale
        if (data) {
          this.sendData(data);
        } else {
          this.sendData(this.resolveStatic(filePath, line, col, componentInfo.name));
        }
      })
      .catch(() => {
        if (this.generation !== gen) return;
        this.sendData(this.resolveStatic(filePath, line, col, componentInfo.name));
      });
```

With:

```typescript
    // Try live data first, fall back to static
    this.resolveLive(params.uri, filePath, line, col, componentInfo.name, gen)
      .then((data) => {
        if (this.generation !== gen) return; // stale
        const resolved = data ?? this.resolveStatic(filePath, line, col, componentInfo.name);
        this.sendData(resolved);
        // Phase 2: async AI analysis (non-blocking)
        this.resolveVisualAnalysis(params.uri, resolved, gen);
      })
      .catch(() => {
        if (this.generation !== gen) return;
        this.sendData(this.resolveStatic(filePath, line, col, componentInfo.name));
      });
```

**Step 4: Add `resolveVisualAnalysis` method**

Add this private method to the class (before the `extractStyles` method):

```typescript
  private async resolveVisualAnalysis(
    uri: string,
    data: InspectorData,
    gen: number,
  ): Promise<void> {
    if (!this.visualAnalyzer || !data.screenshot) return;

    const result = await this.visualAnalyzer.analyze(
      data.screenshot,
      data.componentName,
      data.computedStyles,
      data.inlineStyles,
      data.tokenMatches ?? null,
    );

    if (this.generation !== gen || !result) return;

    const enriched = { ...data, visualAnalysis: result };
    this.sendData(enriched);
    this.onAiAnalysis?.(uri, enriched);
  }
```

**Step 5: Build server**

Run: `pnpm --filter @ui-ls/shared build && pnpm --filter @ui-ls/server build`
Expected: Builds successfully.

**Step 6: Commit**

```bash
git add packages/server/src/inspector/inspector-provider.ts
git commit -m "feat: wire VisualAnalyzer into InspectorProvider two-phase send"
```

---

### Task 6: Wire into server.ts — init + AI diagnostics

**Files:**
- Modify: `packages/server/src/server.ts:31,48-50,57-83,173-178`

**Step 1: Add import**

After the `computeStyleEdit` import (line 31):

```typescript
import { VisualAnalyzer } from './ai/visual-analyzer.js';
```

**Step 2: Add AI diagnostics cache**

After `const LIVE_VALIDATE_DEBOUNCE = 2_000;` (line 55):

```typescript
const aiDiagnosticsCache = new Map<string, Diagnostic[]>();
```

**Step 3: Initialize VisualAnalyzer in `onInitialize`**

After the `createProviders(cdpConnection);` line (line 105), add:

```typescript
  // Initialize AI visual analyzer if API key is available
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const visualAnalyzer = new VisualAnalyzer(anthropicKey);
    inspectorProvider.setVisualAnalyzer(visualAnalyzer);
  }
```

**Step 4: Wire up AI diagnostics callback**

After the existing `inspectorProvider.onLiveData = ...` block (after line 82), add:

```typescript
  // AI visual analysis → publish as diagnostics
  inspectorProvider.onAiAnalysis = (uri, data) => {
    if (!data.visualAnalysis) return;
    const diags: Diagnostic[] = [];
    for (const suggestion of data.visualAnalysis.suggestions) {
      if (!suggestion.property) continue;
      // Find the inline style range for this property
      const inlineInfo = data.inlineStyles.find(
        (s) => s.camelName === suggestion.property,
      );
      if (!inlineInfo) continue;
      diags.push({
        range: inlineInfo.range,
        message: suggestion.message,
        severity: suggestion.severity === 'warning'
          ? 2 /* DiagnosticSeverity.Warning */
          : 3 /* DiagnosticSeverity.Information */,
        source: 'ui-ls-ai',
      });
    }
    aiDiagnosticsCache.set(uri, diags);
    publishMergedDiagnostics(uri);
  };
```

**Step 5: Merge AI diagnostics into `publishMergedDiagnostics`**

Replace the `publishMergedDiagnostics` function (lines 173-178):

```typescript
function publishMergedDiagnostics(uri: string): void {
  const filePath = uriToPath(uri);
  const staticDiags = diagnosticsProvider.validate(uri, filePath);
  const liveDiags = liveDiagnosticsCache.get(uri) ?? [];
  const aiDiags = aiDiagnosticsCache.get(uri) ?? [];
  connection.sendDiagnostics({ uri, diagnostics: [...staticDiags, ...liveDiags, ...aiDiags] });
}
```

**Step 6: Build**

Run: `pnpm --filter @ui-ls/server build`
Expected: Builds successfully.

**Step 7: Run all tests**

Run: `pnpm exec vitest run`
Expected: All tests pass (existing + new visual-analyzer tests).

**Step 8: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "feat: wire VisualAnalyzer into server with AI diagnostics cache"
```

---

### Task 7: Webview HTML — add AI section container

**Files:**
- Modify: `packages/vscode/src/inspector-view.ts:148-155`

**Step 1: Add the AI analysis section to the HTML template**

In `inspector-view.ts`, in the `getHtml` method, between the styles section and props section (between lines 150-152), add:

```html
      <div id="ai-section" hidden>
        <h3>AI Analysis <span id="ai-cached-badge" hidden>(cached)</span></h3>
        <div id="ai-loading" hidden>Analyzing...</div>
        <div id="ai-content" hidden>
          <p id="ai-description"></p>
          <div id="ai-suggestions"></div>
        </div>
      </div>
```

So the full sequence becomes: `styles-section` → `ai-section` → `props-section`.

**Step 2: Commit**

```bash
git add packages/vscode/src/inspector-view.ts
git commit -m "feat: add AI Analysis section container to webview HTML"
```

---

### Task 8: Webview JS — render AI analysis

**Files:**
- Modify: `packages/vscode/media/inspector.js:25-28,78-88`

**Step 1: Add DOM references**

After the `propsEl` reference (line 25), add:

```javascript
const aiSection = document.getElementById('ai-section');
const aiLoading = document.getElementById('ai-loading');
const aiContent = document.getElementById('ai-content');
const aiDescription = document.getElementById('ai-description');
const aiSuggestions = document.getElementById('ai-suggestions');
const aiCachedBadge = document.getElementById('ai-cached-badge');
```

**Step 2: Add AI section rendering to the `render()` function**

After the `renderStyles(data)` call (line 79) and before the Props section (line 82), add:

```javascript
  // AI Analysis
  renderAiAnalysis(data);
```

**Step 3: Add the `renderAiAnalysis` function**

Add this after the `renderStyles` function (after line 146):

```javascript
/**
 * Render the AI Analysis section.
 * @param {InspectorData} data
 */
function renderAiAnalysis(data) {
  if (!data.visualAnalysis && data.source !== 'live') {
    // Static mode without AI — hide section
    aiSection.hidden = true;
    return;
  }

  if (!data.visualAnalysis) {
    // Live mode, analysis pending — show loading
    aiSection.hidden = false;
    aiLoading.hidden = false;
    aiContent.hidden = true;
    aiCachedBadge.hidden = true;
    return;
  }

  // Analysis available — render it
  var analysis = data.visualAnalysis;
  aiSection.hidden = false;
  aiLoading.hidden = true;
  aiContent.hidden = false;
  aiCachedBadge.hidden = !analysis.cached;

  aiDescription.textContent = analysis.description;
  clearChildren(aiSuggestions);

  for (var i = 0; i < analysis.suggestions.length; i++) {
    var suggestion = analysis.suggestions[i];
    var card = document.createElement('div');
    card.className = 'ai-suggestion ' + suggestion.severity;

    var icon = document.createElement('span');
    icon.className = 'ai-suggestion-icon';
    icon.textContent = suggestion.severity === 'warning' ? '\u26A0' : '\u2139';
    card.appendChild(icon);

    var badge = document.createElement('span');
    badge.className = 'ai-category-badge';
    badge.textContent = suggestion.category;
    card.appendChild(badge);

    var msg = document.createElement('span');
    msg.className = 'ai-suggestion-text';
    msg.textContent = suggestion.message;
    card.appendChild(msg);

    aiSuggestions.appendChild(card);
  }
}
```

**Step 4: Commit**

```bash
git add packages/vscode/media/inspector.js
git commit -m "feat: render AI analysis section in inspector webview"
```

---

### Task 9: Webview CSS — AI section styles

**Files:**
- Modify: `packages/vscode/media/inspector.css` (append after `.token-badge` block, before `/* Props */`)

**Step 1: Add styles**

Append before the `/* Props */` comment (before line 252):

```css
/* AI Analysis section */
#ai-section h3 {
  display: flex;
  align-items: center;
  gap: 6px;
}

#ai-cached-badge {
  font-size: 0.75em;
  font-weight: normal;
  text-transform: none;
  letter-spacing: 0;
  color: var(--vscode-descriptionForeground);
}

#ai-loading {
  color: var(--vscode-descriptionForeground);
  font-style: italic;
  padding: 4px 0;
}

#ai-description {
  margin: 4px 0 8px;
  font-size: 0.9em;
  line-height: 1.5;
}

.ai-suggestion {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 8px;
  margin-bottom: 4px;
  border-radius: 3px;
  font-size: 0.85em;
  line-height: 1.4;
}

.ai-suggestion.warning {
  background: var(--vscode-inputValidation-warningBackground, rgba(255, 204, 0, 0.1));
  border-left: 2px solid var(--vscode-inputValidation-warningBorder, #cca700);
}

.ai-suggestion.info {
  background: var(--vscode-inputValidation-infoBackground, rgba(0, 127, 212, 0.1));
  border-left: 2px solid var(--vscode-inputValidation-infoBorder, #007fd4);
}

.ai-suggestion-icon {
  flex-shrink: 0;
  font-size: 0.9em;
}

.ai-category-badge {
  flex-shrink: 0;
  font-size: 0.75em;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.ai-suggestion-text {
  flex: 1;
}
```

**Step 2: Commit**

```bash
git add packages/vscode/media/inspector.css
git commit -m "feat: add AI analysis section styles to inspector"
```

---

### Task 10: Final build and test

**Files:** (none — verification only)

**Step 1: Full build**

Run: `pnpm --filter @ui-ls/shared build && pnpm --filter @ui-ls/server build && pnpm --filter @ui-ls/vscode build`
Expected: All three packages build without errors.

**Step 2: Full test suite**

Run: `pnpm exec vitest run`
Expected: All tests pass (22 existing + 5 new visual-analyzer tests = 27).

**Step 3: Commit the design doc and plan**

```bash
git add docs/plans/2026-03-03-visual-analysis-design.md docs/plans/2026-03-03-visual-analysis-plan.md
git commit -m "docs: add visual analysis design doc and implementation plan"
```

---

## Verification (manual, after all tasks)

1. Set `ANTHROPIC_API_KEY` env var, F5 launch
2. Open sample app, move cursor to a styled component
3. Inspector panel shows component info immediately, then "Analyzing..." appears
4. After ~1-2s, AI Analysis section fills in with description and suggestion cards
5. Move cursor back to the same component — "(cached)" badge appears, no API call
6. Check Problems panel — AI suggestions with `property` targeting inline styles appear as diagnostics with source `ui-ls-ai`
7. Unset `ANTHROPIC_API_KEY`, restart — AI section never appears (feature disabled)
