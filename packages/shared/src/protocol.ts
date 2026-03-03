import type { BoxModelData, ComputedStyles } from './types.js';

/** Custom LSP notification: server → client connection status updates. */
export interface ConnectionStatusNotification {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  port?: number;
  error?: string;
}

/** Request sent via Runtime.evaluate to the browser companion. */
export interface FiberLookupRequest {
  fileName: string;
  line: number;
  column: number;
}

/** Response from the browser companion's fiber lookup. */
export interface FiberLookupResponse {
  found: boolean;
  objectId?: string;
  props?: Record<string, unknown>;
  componentName?: string;
}

export const ConnectionStatusMethod = 'ui-ls/connectionStatus' as const;

/** Client → Server: cursor moved to a new position. */
export interface CursorPositionParams {
  uri: string;
  line: number;
  character: number;
}

export const CursorPositionMethod = 'ui-ls/cursorPosition' as const;

/** Per-property info for inline styles written in source. */
export interface InlineStyleInfo {
  /** kebab-case CSS property name */
  name: string;
  /** camelCase name as written in source (for edits) */
  camelName: string;
  /** Source-authored value */
  value: string;
  /** Source range of the property assignment */
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

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

/** Server → Client: inspector data ready for the webview. */
export interface InspectorData {
  componentName: string;
  filePath: string;
  line: number;
  column: number;
  props: Record<string, unknown>;
  boxModel: BoxModelData | null;
  computedStyles: ComputedStyles;
  /** Inline style properties with source ranges and values */
  inlineStyles: InlineStyleInfo[];
  /** Maps kebab-case prop name → design token path (e.g. "colors.primary") */
  tokenMatches?: Record<string, string>;
  /** AI-generated visual description and UX suggestions */
  visualAnalysis?: VisualAnalysis;
  screenshot: string | null;
  renderedHtml: string | null;
  source: 'live' | 'estimated';
}

export const InspectorDataMethod = 'ui-ls/inspectorData' as const;

/** Client → Server: edit an inline style property. */
export interface StyleEditParams {
  uri: string;
  line: number;
  character: number;
  /** camelCase property name */
  propName: string;
  /** Raw value (e.g. "'absolute'" for strings, "100" for numbers) */
  value: string;
}

export interface StyleEditResult {
  applied: boolean;
  error?: string;
  /** The TextEdit to apply — range + newText (only present when applied is true). */
  edit?: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  };
}

export const StyleEditMethod = 'ui-ls/editStyle' as const;
