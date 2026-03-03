export const DEFAULT_CHROME_DEBUG_PORT = 9222;
export const DEFAULT_RECONNECT_INTERVAL_MS = 1000;
export const MAX_RECONNECT_INTERVAL_MS = 30_000;
export const RECONNECT_BACKOFF_MULTIPLIER = 2;

/** CSS properties shown in the hover display by default. */
export const HOVER_CSS_PROPERTIES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'border',
  'box-sizing',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'overflow',
  'z-index',
  'opacity',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'line-height',
] as const;
