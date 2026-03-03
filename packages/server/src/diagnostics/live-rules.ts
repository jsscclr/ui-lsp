import { DiagnosticSeverity } from 'vscode-languageserver';
import type { BoxModelData, ComputedStyles } from '@ui-ls/shared';
import type { OverflowData } from '../cdp/overflow-query.js';

export interface LiveDiagnosticResult {
  ruleId: string;
  message: string;
  severity: DiagnosticSeverity;
  fixContext: Record<string, unknown>;
}

/**
 * Element renders at zero width or zero height.
 */
export function checkZeroSize(
  box: BoxModelData,
  _styles: ComputedStyles,
): LiveDiagnosticResult | null {
  const w = box.content.width;
  const h = box.content.height;

  if (w === 0 && h === 0) {
    return {
      ruleId: 'zero-size',
      message: `Element renders at 0\u00d70 — it is invisible.`,
      severity: DiagnosticSeverity.Warning,
      fixContext: { width: w, height: h },
    };
  }
  if (w === 0) {
    return {
      ruleId: 'zero-size',
      message: `Element renders at 0\u00d7${h} — zero width collapses it.`,
      severity: DiagnosticSeverity.Warning,
      fixContext: { width: w, height: h },
    };
  }
  if (h === 0) {
    return {
      ruleId: 'zero-size',
      message: `Element renders at ${w}\u00d70 — zero height collapses it.`,
      severity: DiagnosticSeverity.Warning,
      fixContext: { width: w, height: h },
    };
  }
  return null;
}

/**
 * Element content overflows its container.
 */
export function checkOverflow(
  overflow: OverflowData,
): LiveDiagnosticResult | null {
  const hOverflow = overflow.scrollWidth > overflow.clientWidth;
  const vOverflow = overflow.scrollHeight > overflow.clientHeight;

  if (!hOverflow && !vOverflow) return null;

  const axis = hOverflow && vOverflow ? 'both axes'
    : hOverflow ? 'horizontally'
    : 'vertically';

  return {
    ruleId: 'overflow',
    message: `Content overflows ${axis} (scroll: ${overflow.scrollWidth}\u00d7${overflow.scrollHeight}, client: ${overflow.clientWidth}\u00d7${overflow.clientHeight}).`,
    severity: DiagnosticSeverity.Information,
    fixContext: { horizontal: hOverflow, vertical: vOverflow },
  };
}

/**
 * Element is invisible due to CSS (display:none, visibility:hidden, opacity:0).
 */
export function checkInvisible(
  styles: ComputedStyles,
): LiveDiagnosticResult | null {
  if (styles['display'] === 'none') {
    return {
      ruleId: 'invisible',
      message: "Element is hidden by 'display: none'.",
      severity: DiagnosticSeverity.Hint,
      fixContext: { hidingProp: 'display' },
    };
  }
  if (styles['visibility'] === 'hidden') {
    return {
      ruleId: 'invisible',
      message: "Element is hidden by 'visibility: hidden'.",
      severity: DiagnosticSeverity.Hint,
      fixContext: { hidingProp: 'visibility' },
    };
  }
  if (styles['opacity'] === '0') {
    return {
      ruleId: 'invisible',
      message: "Element is hidden by 'opacity: 0'.",
      severity: DiagnosticSeverity.Hint,
      fixContext: { hidingProp: 'opacity' },
    };
  }
  return null;
}

/**
 * Text is clipped by overflow/text-overflow settings.
 */
export function checkClippedText(
  styles: ComputedStyles,
  overflow: OverflowData,
): LiveDiagnosticResult | null {
  const hasEllipsis = styles['text-overflow'] === 'ellipsis';
  const isClipping = overflow.scrollWidth > overflow.clientWidth;

  if (!hasEllipsis || !isClipping) return null;

  return {
    ruleId: 'clipped-text',
    message: `Text is clipped with ellipsis (${overflow.scrollWidth - overflow.clientWidth}px hidden).`,
    severity: DiagnosticSeverity.Information,
    fixContext: {},
  };
}
