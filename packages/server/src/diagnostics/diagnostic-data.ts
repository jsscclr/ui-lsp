import type { Range } from 'vscode-languageserver';

/**
 * Attached to `Diagnostic.data` so code actions can generate fixes
 * without re-querying the AST or CDP.
 */
export interface DiagnosticData {
  /** Identifies the rule that produced this diagnostic (e.g. 'flex-without-display'). */
  ruleId: string;
  /**
   * Position info for the style={{...}} object literal.
   * null when the element has no inline style attribute (live diagnostics may
   * flag elements without style={{}}; code actions that need to add one use
   * createStyleAttrEdit instead).
   */
  styleAttr: StyleAttrData | null;
  /** Rule-specific context consumed by the fix generator. */
  fixContext: Record<string, unknown>;
}

export interface StyleAttrData {
  /** Position of the `{` opening the object literal in style={{...}}. */
  objLiteralStart: { line: number; character: number };
  /** Position of the `}` closing the object literal. */
  objLiteralEnd: { line: number; character: number };
  /** Existing properties — used by add/modify/remove logic. */
  existingProps: Array<{ name: string; value: string; range: Range }>;
}
