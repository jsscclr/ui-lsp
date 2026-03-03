import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { ComputedStyles } from '@ui-ls/shared';

/**
 * Extracts inline style={{...}} object literals from JSX elements.
 *
 * First milestone scope: only handles direct object literal expressions.
 * Does NOT resolve variable references, function calls, or spread elements.
 */
export function extractInlineStyles(
  source: SourceFile,
  line: number,
  column: number,
): ComputedStyles {
  const pos = source.compilerNode.getPositionOfLineAndCharacter(line, column);
  const styles: ComputedStyles = {};

  // Find JSX elements at position
  const allJsx = [
    ...source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  let target = allJsx.find((jsx) => {
    const start = jsx.getStart();
    const end = jsx.getEnd();
    return pos >= start && pos <= end;
  });

  if (!target) return styles;

  // Look for style attribute
  for (const attr of target.getAttributes()) {
    if (attr.getKind() !== SyntaxKind.JsxAttribute) continue;
    const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute)!;
    if (jsxAttr.getNameNode().getText() !== 'style') continue;

    const init = jsxAttr.getInitializer();
    if (!init) continue;

    // style={...} → the initializer is a JsxExpression containing the object
    if (init.getKind() !== SyntaxKind.JsxExpression) continue;
    const expr = init.asKind(SyntaxKind.JsxExpression)!.getExpression();
    if (!expr || expr.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

    const objLiteral = expr.asKind(SyntaxKind.ObjectLiteralExpression)!;
    for (const prop of objLiteral.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const assignment = prop.asKind(SyntaxKind.PropertyAssignment)!;
      const propName = assignment.getName();
      const initializer = assignment.getInitializer();
      if (!initializer) continue;

      // Convert camelCase to kebab-case for CSS property names
      const cssName = camelToKebab(propName);

      // Extract literal values
      const kind = initializer.getKind();
      if (kind === SyntaxKind.StringLiteral) {
        styles[cssName] = initializer.asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
      } else if (kind === SyntaxKind.NumericLiteral) {
        const num = initializer.asKind(SyntaxKind.NumericLiteral)!.getLiteralValue();
        // Numeric values in React inline styles default to px for most properties
        styles[cssName] = needsPxSuffix(cssName) ? `${num}px` : String(num);
      } else {
        // Non-literal: show source text
        styles[cssName] = initializer.getText();
      }
    }
  }

  return styles;
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/** CSS properties that accept unitless numbers in React (no px suffix needed). */
const UNITLESS_PROPERTIES = new Set([
  'animation-iteration-count', 'column-count', 'columns', 'flex',
  'flex-grow', 'flex-shrink', 'font-weight', 'line-height', 'opacity',
  'order', 'orphans', 'tab-size', 'widows', 'z-index', 'zoom',
]);

function needsPxSuffix(property: string): boolean {
  return !UNITLESS_PROPERTIES.has(property);
}
