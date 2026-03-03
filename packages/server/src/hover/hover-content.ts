import type { BoxModelData, ComputedStyles, HoverData } from '@ui-ls/shared';

/** Style property groups displayed in the hover tooltip. */
const STYLE_GROUPS: { label: string; props: string[] }[] = [
  {
    label: 'Layout',
    props: [
      'display', 'position', 'box-sizing',
      'flex-direction', 'justify-content', 'align-items', 'gap',
      'grid-template-columns', 'grid-template-rows',
      'overflow', 'z-index',
    ],
  },
  {
    label: 'Typography',
    props: ['font-size', 'font-weight', 'line-height', 'color'],
  },
  {
    label: 'Visual',
    props: ['background-color', 'border', 'opacity'],
  },
];

const SKIP_VALUES = new Set(['initial', 'none', 'normal', 'auto', '0', '0px']);

/**
 * Formats HoverData into compact Markdown for the LSP hover response.
 */
export function formatHoverContent(data: HoverData): string {
  const parts: string[] = [];
  const tag = data.source === 'live' ? '(live)' : '(estimated)';

  parts.push(`**${data.componentInfo.name}** ${tag}`);

  // Screenshot (downscaled server-side to fit the tooltip)
  if (data.source === 'live' && data.screenshot) {
    parts.push(`![${data.componentInfo.name}](data:image/png;base64,${data.screenshot})`);
  }

  // Compact box model: `773 × 231` · padding: `16` · border: `0.7` · margin: `0`
  if (data.boxModel) {
    parts.push(renderCompactBoxModel(data.boxModel));
  }

  // Grouped styles
  const groupLines = renderStyleGroups(data.computedStyles);
  if (groupLines.length > 0) {
    parts.push(groupLines.join('\n\n'));
  }

  return parts.join('\n\n');
}

function renderCompactBoxModel(box: BoxModelData): string {
  const size = `\`${fmt(box.content.width)} × ${fmt(box.content.height)}\``;
  const segments: string[] = [size];

  const padding = summarizeEdges(box.padding);
  if (padding !== null) segments.push(`padding: \`${padding}\``);

  const border = summarizeEdges(box.border);
  if (border !== null) segments.push(`border: \`${border}\``);

  const margin = summarizeEdges(box.margin);
  if (margin !== null) segments.push(`margin: \`${margin}\``);

  return segments.join(' · ');
}

/** Summarize edge values: uniform → single value, mixed → `top right bottom left`. Null if all zero. */
function summarizeEdges(edges: { top: number; right: number; bottom: number; left: number }): string | null {
  const { top, right, bottom, left } = edges;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return null;
  if (top === right && right === bottom && bottom === left) return fmt(top);
  if (top === bottom && left === right) return `${fmt(top)} ${fmt(left)}`;
  return `${fmt(top)} ${fmt(right)} ${fmt(bottom)} ${fmt(left)}`;
}

function renderStyleGroups(styles: ComputedStyles): string[] {
  const lines: string[] = [];
  for (const group of STYLE_GROUPS) {
    const values: string[] = [];
    for (const prop of group.props) {
      const val = styles[prop];
      if (val && !SKIP_VALUES.has(val)) {
        values.push(`\`${prop}: ${val}\``);
      }
    }
    if (values.length > 0) {
      lines.push(`**${group.label}** — ${values.join(' · ')}`);
    }
  }
  return lines;
}

function fmt(n: number): string {
  if (n === 0) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
