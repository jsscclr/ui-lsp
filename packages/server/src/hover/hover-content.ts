import { HOVER_CSS_PROPERTIES, type BoxModelData, type ComputedStyles, type HoverData } from '@ui-ls/shared';

/**
 * Formats HoverData into Markdown MarkupContent for the LSP hover response.
 * Includes ASCII box model, computed styles table, and component props.
 */
export function formatHoverContent(data: HoverData): string {
  const parts: string[] = [];
  const tag = data.source === 'live' ? '(live)' : '(estimated)';

  // Header
  parts.push(`**${data.componentInfo.name}** ${tag}\n`);

  // Live screenshot preview
  if ('screenshot' in data && data.screenshot) {
    parts.push(`![${data.componentInfo.name}](data:image/png;base64,${data.screenshot})`);
  }

  // Box model diagram
  if (data.boxModel) {
    parts.push(renderBoxModel(data.boxModel));
  }

  // Computed styles table
  const styleEntries = filterStyles(data.computedStyles);
  if (styleEntries.length > 0) {
    parts.push(renderStylesTable(styleEntries));
  }

  // Props
  const propEntries = Object.entries(data.componentInfo.props);
  if (propEntries.length > 0) {
    parts.push(renderProps(propEntries));
  }

  return parts.join('\n---\n');
}

function renderBoxModel(box: BoxModelData): string {
  const m = box.margin;
  const b = box.border;
  const p = box.padding;
  const c = box.content;

  const contentW = fmt(c.width);
  const contentH = fmt(c.height);
  const contentLabel = `${contentW} × ${contentH}`;

  // Build the ASCII box model diagram
  // Each nested box is represented with its edge values
  const lines: string[] = [];
  lines.push('```');
  lines.push(`┌ margin ──────────────────────────┐`);
  lines.push(`│ ${pad(fmt(m.top), 34)}│`);
  lines.push(`│${pad(fmt(m.left), 3)}┌ border ─────────────────────┐${pad(fmt(m.right), 3)}│`);
  lines.push(`│   │ ${pad(fmt(b.top), 29)}│   │`);
  lines.push(`│   │${pad(fmt(b.left), 2)}┌ padding ──────────────┐${pad(fmt(b.right), 2)}│   │`);
  lines.push(`│   │  │ ${pad(fmt(p.top), 22)}│  │   │`);
  lines.push(`│   │  │${pad(fmt(p.left), 2)}┌──────────────┐${pad(fmt(p.right), 2)}│  │   │`);
  lines.push(`│   │  │  │${pad(contentLabel, 14)}│  │  │   │`);
  lines.push(`│   │  │${pad(fmt(p.left), 2)}└──────────────┘${pad(fmt(p.right), 2)}│  │   │`);
  lines.push(`│   │  │ ${pad(fmt(p.bottom), 22)}│  │   │`);
  lines.push(`│   │${pad(fmt(b.left), 2)}└──────────────────────┘${pad(fmt(b.right), 2)}│   │`);
  lines.push(`│   │ ${pad(fmt(b.bottom), 29)}│   │`);
  lines.push(`│${pad(fmt(m.left), 3)}└─────────────────────────────┘${pad(fmt(m.right), 3)}│`);
  lines.push(`│ ${pad(fmt(m.bottom), 34)}│`);
  lines.push(`└───────────────────────────────────┘`);
  lines.push('```');

  return lines.join('\n');
}

function renderStylesTable(entries: [string, string][]): string {
  const lines: string[] = [];
  lines.push('**Computed Styles**\n');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  for (const [prop, value] of entries) {
    lines.push(`| \`${prop}\` | \`${value}\` |`);
  }
  return lines.join('\n');
}

function renderProps(entries: [string, unknown][]): string {
  const lines: string[] = [];
  lines.push('**Props**\n');
  lines.push('```');
  for (const [key, value] of entries) {
    const display = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
    lines.push(`${key}: ${display}`);
  }
  lines.push('```');
  return lines.join('\n');
}

/** Filter computed styles to the configured subset for display. */
function filterStyles(styles: ComputedStyles): [string, string][] {
  const result: [string, string][] = [];
  for (const prop of HOVER_CSS_PROPERTIES) {
    const value = styles[prop];
    if (value && value !== 'initial' && value !== 'none' && value !== 'normal' && value !== 'auto') {
      result.push([prop, value]);
    }
  }
  return result;
}

/** Format a number for the box model diagram. */
function fmt(n: number): string {
  if (n === 0) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Center-pad a string to a target width. */
function pad(str: string, width: number): string {
  if (str.length >= width) return str;
  const total = width - str.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}
