# Visual Previews Design

## Vision

Three incremental phases to make the UI Language Server more visual:

1. **Element screenshots in hover** (this phase) — hover over JSX → see a live screenshot of that element from Chrome
2. **Browser highlight sync** (future) — hover in VS Code → element highlights in Chrome; click in Chrome → cursor jumps to source
3. **Webview preview panel** (future) — side panel with live component view and box model overlay

---

## Phase 1: Element Screenshots in Hover

### Overview

When hovering over a JSX element with a live CDP connection, capture a screenshot of just that DOM element and embed it as a base64 PNG image at the top of the hover tooltip. The existing ASCII box model, computed styles table, and props display remain below.

When CDP is disconnected, the hover looks exactly as it does today (ASCII box model fallback).

### Data Flow

1. User hovers over JSX element
2. `HoverProvider.onHover()` calls `SourceMapper.lookupLive()`
3. `lookupLive()` resolves fiber → DOM objectId → nodeId (existing)
4. **New**: In parallel with `getBoxModel()` + `getComputedStyle()`, call `captureElementScreenshot()`
5. `captureElementScreenshot()`:
   - Calls `DOM.getBoxModel(nodeId)` to get element's viewport coordinates
   - Computes clip rect from the margin quad (outermost box)
   - Caps dimensions at 600×400 device pixels, scaling proportionally if needed
   - Calls `Page.captureScreenshot({ clip, format: 'png' })`
   - Returns base64 string or null on failure
6. Screenshot is added to `LiveHoverData.screenshot`
7. `formatHoverContent()` prepends `![preview](data:image/png;base64,...)` when screenshot present

### File Changes

| File | Change |
|---|---|
| `packages/server/src/cdp/cdp-domains.ts` | Add `captureElementScreenshot(client, nodeId)` |
| `packages/shared/src/types.ts` | Add `screenshot?: string` to `LiveHoverData` |
| `packages/server/src/source-mapping/source-mapper.ts` | Call screenshot in `lookupLive()`, parallel with existing fetches |
| `packages/server/src/hover/hover-content.ts` | Prepend image markdown when `data.screenshot` present |

### Screenshot Sizing

- Max output dimensions: 600×400 device pixels
- If element exceeds either dimension, scale the clip proportionally to fit
- CDP `captureScreenshot` `clip.scale` parameter handles the downscaling
- Zero-dimension elements (hidden, collapsed) → skip screenshot silently

### Error Handling

`captureElementScreenshot` returns null on any failure:
- Element not visible / zero dimensions
- CDP error (detached, navigation in progress)
- Screenshot timeout

The hover gracefully falls back to text-only content. No degradation to existing behavior.

### Caching

Screenshots are cached as part of the existing hover content string in `HoverCache` (5-second TTL). No separate screenshot cache. The base64 string is part of the markdown content.

### Design Decisions

- **No separate image endpoint**: LSP hover markdown supports data URIs, so no need for a file server or temp files.
- **Margin quad for clip rect**: Using the outermost (margin) box gives context around the element, not just the content box.
- **600×400 cap**: Keeps hover tooltips readable. Most components are smaller; this handles full-width containers gracefully.
- **Parallel fetch**: Screenshot runs alongside box model + computed style fetches to minimize latency.

---

## Future Phases (Not In Scope)

### Phase 2: Browser Highlight Sync

- Use CDP `Overlay.highlightNode()` to highlight DOM elements when hovering in VS Code
- Use CDP `Overlay.setInspectMode()` for reverse: click element in Chrome → VS Code navigates to source
- Requires bidirectional event handling

### Phase 3: Webview Preview Panel

- VS Code webview panel showing rendered component
- Box model overlay visualization (replacing ASCII art with visual diagram)
- Auto-refresh on file save
- Component tree navigation
