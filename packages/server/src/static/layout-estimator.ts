import Yoga, { Edge, Direction } from 'yoga-layout';
import type { BoxModelData, ComputedStyles } from '@ui-ls/shared';

/**
 * Feeds extracted inline styles into yoga-layout to produce an approximate
 * box model. Only handles px values for this first milestone.
 *
 * Returns BoxModelData marked as estimated by the caller.
 */
export function estimateLayout(styles: ComputedStyles): BoxModelData | null {
  const node = Yoga.Node.create();

  try {
    applyStyles(node, styles);
    node.calculateLayout(undefined, undefined, Direction.LTR);

    const layout = node.getComputedLayout();
    const pl = node.getComputedPadding(Edge.Left);
    const pr = node.getComputedPadding(Edge.Right);
    const pt = node.getComputedPadding(Edge.Top);
    const pb = node.getComputedPadding(Edge.Bottom);
    const bl = node.getComputedBorder(Edge.Left);
    const br = node.getComputedBorder(Edge.Right);
    const bt = node.getComputedBorder(Edge.Top);
    const bb = node.getComputedBorder(Edge.Bottom);

    // Yoga's layout.width/height are outer dimensions — subtract padding + border for content
    const contentWidth = Math.max(0, layout.width - pl - pr - bl - br);
    const contentHeight = Math.max(0, layout.height - pt - pb - bt - bb);

    return {
      content: {
        x: layout.left,
        y: layout.top,
        width: contentWidth,
        height: contentHeight,
      },
      padding: { top: pt, right: pr, bottom: pb, left: pl },
      border: { top: bt, right: br, bottom: bb, left: bl },
      margin: {
        top: node.getComputedMargin(Edge.Top),
        right: node.getComputedMargin(Edge.Right),
        bottom: node.getComputedMargin(Edge.Bottom),
        left: node.getComputedMargin(Edge.Left),
      },
    };
  } catch {
    return null;
  } finally {
    node.freeRecursive();
  }
}

type YogaNode = ReturnType<typeof Yoga.Node.create>;

function applyStyles(node: YogaNode, styles: ComputedStyles): void {
  for (const [prop, value] of Object.entries(styles)) {
    const px = parsePx(value);

    switch (prop) {
      case 'width':
        if (px !== null) node.setWidth(px);
        break;
      case 'height':
        if (px !== null) node.setHeight(px);
        break;

      // Padding
      case 'padding':
        if (px !== null) node.setPadding(Edge.All, px);
        break;
      case 'padding-top':
        if (px !== null) node.setPadding(Edge.Top, px);
        break;
      case 'padding-right':
        if (px !== null) node.setPadding(Edge.Right, px);
        break;
      case 'padding-bottom':
        if (px !== null) node.setPadding(Edge.Bottom, px);
        break;
      case 'padding-left':
        if (px !== null) node.setPadding(Edge.Left, px);
        break;

      // Margin
      case 'margin':
        if (px !== null) node.setMargin(Edge.All, px);
        break;
      case 'margin-top':
        if (px !== null) node.setMargin(Edge.Top, px);
        break;
      case 'margin-right':
        if (px !== null) node.setMargin(Edge.Right, px);
        break;
      case 'margin-bottom':
        if (px !== null) node.setMargin(Edge.Bottom, px);
        break;
      case 'margin-left':
        if (px !== null) node.setMargin(Edge.Left, px);
        break;

      // Border
      case 'border-width':
        if (px !== null) node.setBorder(Edge.All, px);
        break;
      case 'border-top-width':
        if (px !== null) node.setBorder(Edge.Top, px);
        break;
      case 'border-right-width':
        if (px !== null) node.setBorder(Edge.Right, px);
        break;
      case 'border-bottom-width':
        if (px !== null) node.setBorder(Edge.Bottom, px);
        break;
      case 'border-left-width':
        if (px !== null) node.setBorder(Edge.Left, px);
        break;

      // Flex
      case 'flex-grow':
        if (px !== null) node.setFlexGrow(px);
        break;
      case 'flex-shrink':
        if (px !== null) node.setFlexShrink(px);
        break;

      // Skip non-layout properties silently
    }
  }
}

/** Parse a CSS px value. Returns null for non-px or unparseable values. */
function parsePx(value: string): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.endsWith('px')) {
    const num = parseFloat(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  // Plain number (e.g., "0")
  const num = parseFloat(trimmed);
  if (trimmed === String(num) && Number.isFinite(num)) {
    return num;
  }
  return null;
}
