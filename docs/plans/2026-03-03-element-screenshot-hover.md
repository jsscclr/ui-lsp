# Element Screenshot Hover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Embed a live screenshot of a DOM element in the VS Code hover tooltip when CDP is connected.

**Architecture:** `captureElementScreenshot()` in cdp-domains.ts computes a clip rect from the element's margin quad, calls `Page.captureScreenshot`, returns base64 PNG. `SourceMapper.lookupLive()` calls it in parallel with existing box model + style fetches. `formatHoverContent()` prepends an image markdown tag.

**Tech Stack:** CDP `Page.captureScreenshot` + `DOM.getBoxModel`, LSP Markdown hover with data URI images, ts-morph AST

---

### Task 1: Add `screenshot` field to LiveHoverData

**Files:**
- Modify: `packages/shared/src/types.ts:23-28`

**Step 1: Add field**

In `packages/shared/src/types.ts`, add `screenshot?: string` to the `LiveHoverData` interface:

```typescript
export interface LiveHoverData {
  source: 'live';
  componentInfo: ComponentInfo;
  boxModel: BoxModelData;
  computedStyles: ComputedStyles;
  screenshot?: string;
}
```

**Step 2: Build shared package**

Run: `pnpm --filter @ui-ls/shared build`
Expected: exits 0, no type errors

**Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "Add screenshot field to LiveHoverData"
```

---

### Task 2: Add `captureElementScreenshot` to cdp-domains

**Files:**
- Modify: `packages/server/src/cdp/cdp-domains.ts` (append new function)

**Step 1: Implement the function**

Add to the end of `packages/server/src/cdp/cdp-domains.ts`:

```typescript
const MAX_SCREENSHOT_WIDTH = 600;
const MAX_SCREENSHOT_HEIGHT = 400;

/**
 * Capture a PNG screenshot of a single DOM element, clipped to its margin box.
 * Returns a base64-encoded PNG string, or null if the element can't be captured.
 */
export async function captureElementScreenshot(
  client: CDPClient,
  nodeId: number,
): Promise<string | null> {
  // Get the raw box model — we need the margin quad for the clip rect
  let rawModel: CDPBoxModel;
  try {
    const result = (await client.send('DOM.getBoxModel', { nodeId })) as { model: CDPBoxModel };
    rawModel = result.model;
  } catch {
    return null;
  }

  // Margin quad: [x1,y1, x2,y2, x3,y3, x4,y4] clockwise from top-left
  const mq = rawModel.margin;
  const x = mq[0];
  const y = mq[1];
  const width = mq[2] - mq[0];
  const height = mq[5] - mq[1];

  // Skip zero-size elements
  if (width <= 0 || height <= 0) return null;

  // Scale down if element exceeds max dimensions
  let scale = 1;
  if (width > MAX_SCREENSHOT_WIDTH) scale = Math.min(scale, MAX_SCREENSHOT_WIDTH / width);
  if (height > MAX_SCREENSHOT_HEIGHT) scale = Math.min(scale, MAX_SCREENSHOT_HEIGHT / height);

  try {
    const result = (await client.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x, y, width, height, scale },
    })) as { data: string };
    return result.data;
  } catch {
    return null;
  }
}
```

**Step 2: Verify build**

Run: `pnpm --filter @ui-ls/server build`
Expected: exits 0

**Step 3: Commit**

```bash
git add packages/server/src/cdp/cdp-domains.ts
git commit -m "Add captureElementScreenshot to CDP domain helpers"
```

---

### Task 3: Call screenshot in SourceMapper.lookupLive()

**Files:**
- Modify: `packages/server/src/source-mapping/source-mapper.ts:1-4` (imports) and `:46-64` (lookupLive body)

**Step 1: Add import**

At the top of `source-mapper.ts`, add `captureElementScreenshot` to the existing import from `cdp-domains.js`:

```typescript
import { getBoxModel, getComputedStyle, requestNodeForObject, getDocument, captureElementScreenshot } from '../cdp/cdp-domains.js';
```

**Step 2: Add screenshot to parallel fetch**

In `lookupLive()`, change the existing `Promise.all` block (line 46-49) from:

```typescript
    const [boxModel, computedStyles] = await Promise.all([
      getBoxModel(client, nodeId),
      getComputedStyle(client, nodeId),
    ]);
```

to:

```typescript
    const [boxModel, computedStyles, screenshot] = await Promise.all([
      getBoxModel(client, nodeId),
      getComputedStyle(client, nodeId),
      captureElementScreenshot(client, nodeId),
    ]);
```

**Step 3: Add screenshot to return value**

Change the return statement (around line 59-64) from:

```typescript
    return {
      source: 'live',
      componentInfo,
      boxModel,
      computedStyles,
    };
```

to:

```typescript
    return {
      source: 'live',
      componentInfo,
      boxModel,
      computedStyles,
      ...(screenshot ? { screenshot } : {}),
    };
```

**Step 4: Verify build**

Run: `pnpm --filter @ui-ls/server build`
Expected: exits 0

**Step 5: Commit**

```bash
git add packages/server/src/source-mapping/source-mapper.ts
git commit -m "Capture element screenshot in parallel during live lookup"
```

---

### Task 4: Render screenshot in hover markdown

**Files:**
- Modify: `packages/server/src/hover/hover-content.ts:7-12` (formatHoverContent body)

**Step 1: Add screenshot rendering**

In `formatHoverContent()`, after the header line (`parts.push(\`**${data.componentInfo.name}** ${tag}\n\`)`), add:

```typescript
  // Live screenshot preview
  if ('screenshot' in data && data.screenshot) {
    parts.push(`![${data.componentInfo.name}](data:image/png;base64,${data.screenshot})`);
  }
```

This goes between the header push (line ~12) and the box model section (line ~15).

**Step 2: Verify build**

Run: `pnpm --filter @ui-ls/server build`
Expected: exits 0

**Step 3: Run all tests**

Run: `pnpm exec vitest run`
Expected: 22/22 pass (no existing test exercises screenshot path — the static hover tests don't set a screenshot field)

**Step 4: Commit**

```bash
git add packages/server/src/hover/hover-content.ts
git commit -m "Render element screenshot in hover markdown"
```

---

### Task 5: Full build and verification

**Step 1: Build both packages**

Run: `pnpm --filter @ui-ls/server build && pnpm --filter @ui-ls/vscode build`
Expected: both exit 0

**Step 2: Run all tests**

Run: `pnpm exec vitest run`
Expected: all tests pass, no regressions

**Step 3: Final commit (squash-friendly message)**

```bash
git add -A
git commit -m "Add live element screenshot preview to hover tooltip

When CDP is connected, captures a PNG screenshot of the hovered DOM
element and embeds it as a base64 data URI in the hover markdown.
Falls back to existing ASCII box model when disconnected.

Uses Page.captureScreenshot with margin-box clip rect, capped at
600x400 pixels with proportional scaling for large elements."
```

Note: only create this commit if there are remaining unstaged changes. If all prior task commits captured everything, skip.

---

## File Summary

| File | Change |
|---|---|
| `packages/shared/src/types.ts` | Add `screenshot?: string` to `LiveHoverData` |
| `packages/server/src/cdp/cdp-domains.ts` | Add `captureElementScreenshot(client, nodeId)` |
| `packages/server/src/source-mapping/source-mapper.ts` | Call screenshot in parallel in `lookupLive()` |
| `packages/server/src/hover/hover-content.ts` | Prepend `![preview](data:image/png;base64,...)` when screenshot present |
