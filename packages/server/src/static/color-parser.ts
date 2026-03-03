/**
 * Parses CSS color strings into LSP-compatible { red, green, blue, alpha } (floats 0–1).
 * Supports hex (#RGB, #RRGGBB, #RRGGBBAA), rgb()/rgba(), and CSS named colors.
 */

export interface LspColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** CSS properties whose values are colors (camelCase as written in JSX). */
export const COLOR_PROPERTIES = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'fill',
  'stroke',
]);

/** Shorthand properties that may contain an embedded color (e.g. border: '2px solid #abc'). */
export const SHORTHAND_COLOR_PROPERTIES = new Set([
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'outline',
]);

/**
 * Parse a CSS color string into LSP floats, or null if not a recognized color.
 */
export function parseColor(value: string): LspColor | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return parseHex(trimmed);
  if (trimmed.startsWith('rgb')) return parseRgb(trimmed);
  return parseNamedColor(trimmed);
}

/**
 * Extract a color from a shorthand value like "2px solid #3498db".
 * Returns the color and its offset within the string.
 */
export function extractColorFromShorthand(
  value: string,
): { color: LspColor; offset: number; length: number } | null {
  // Try hex
  const hexMatch = value.match(/#(?:[0-9a-fA-F]{3,4}){1,2}\b/);
  if (hexMatch) {
    const color = parseHex(hexMatch[0]);
    if (color) return { color, offset: hexMatch.index!, length: hexMatch[0].length };
  }

  // Try rgb()/rgba()
  const rgbMatch = value.match(/rgba?\([^)]+\)/);
  if (rgbMatch) {
    const color = parseRgb(rgbMatch[0]);
    if (color) return { color, offset: rgbMatch.index!, length: rgbMatch[0].length };
  }

  // Try named color — check each word token
  const wordRe = /[a-zA-Z]+/g;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(value)) !== null) {
    // Skip CSS keywords that aren't colors
    if (BORDER_STYLE_KEYWORDS.has(match[0].toLowerCase())) continue;
    const color = parseNamedColor(match[0]);
    if (color) return { color, offset: match.index, length: match[0].length };
  }

  return null;
}

function parseHex(hex: string): LspColor | null {
  const h = hex.slice(1); // strip '#'
  let r: number, g: number, b: number, a = 1;

  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16) / 255;
    g = parseInt(h[1] + h[1], 16) / 255;
    b = parseInt(h[2] + h[2], 16) / 255;
  } else if (h.length === 4) {
    r = parseInt(h[0] + h[0], 16) / 255;
    g = parseInt(h[1] + h[1], 16) / 255;
    b = parseInt(h[2] + h[2], 16) / 255;
    a = parseInt(h[3] + h[3], 16) / 255;
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
  } else if (h.length === 8) {
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
    a = parseInt(h.slice(6, 8), 16) / 255;
  } else {
    return null;
  }

  if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
  return { red: r, green: g, blue: b, alpha: a };
}

function parseRgb(str: string): LspColor | null {
  // rgb(255, 128, 0) or rgba(255, 128, 0, 0.5)
  const match = str.match(
    /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+))?\s*\)/,
  );
  if (!match) return null;

  const r = parseInt(match[1], 10) / 255;
  const g = parseInt(match[2], 10) / 255;
  const b = parseInt(match[3], 10) / 255;
  const a = match[4] !== undefined ? parseFloat(match[4]) : 1;

  if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
  return { red: r, green: g, blue: b, alpha: a };
}

function parseNamedColor(name: string): LspColor | null {
  const hex = NAMED_COLORS[name.toLowerCase()];
  if (!hex) return null;
  return parseHex(hex);
}

/** Convert LSP color back to a hex string. */
export function colorToHex(color: LspColor): string {
  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  if (color.alpha < 1) {
    return hex + toHex(Math.round(color.alpha * 255));
  }
  return hex;
}

/** Convert LSP color to rgb()/rgba() string. */
export function colorToRgb(color: LspColor): string {
  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);
  if (color.alpha < 1) {
    return `rgba(${r}, ${g}, ${b}, ${color.alpha})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

const BORDER_STYLE_KEYWORDS = new Set([
  'none', 'hidden', 'dotted', 'dashed', 'solid', 'double',
  'groove', 'ridge', 'inset', 'outset', 'initial', 'inherit',
]);

/** CSS named colors → hex values. */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
  transparent: '#00000000',
};
