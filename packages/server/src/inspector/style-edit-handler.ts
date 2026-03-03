import { SyntaxKind } from 'ts-morph';
import type { TextEdit } from 'vscode-languageserver';
import type { JsxAnalyzer } from '../static/jsx-analyzer.js';
import { extractPropertyMap, buildStyleAttrData } from '../diagnostics/diagnostics-provider.js';
import { addOrModifyPropertyEdit } from '../code-actions/style-edit-utils.js';

/**
 * Walk the AST at the given cursor position, find the style={{}} object,
 * and return a TextEdit that adds or modifies the given property.
 */
export function computeStyleEdit(
  jsxAnalyzer: JsxAnalyzer,
  uri: string,
  line: number,
  character: number,
  propName: string,
  value: string,
): TextEdit | null {
  const filePath = uriToPath(uri);
  const source = jsxAnalyzer.getSourceFile(filePath);
  if (!source) return null;

  const pos = source.compilerNode.getPositionOfLineAndCharacter(line, character);

  // Find innermost JSX element at cursor
  const allJsx = [
    ...source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  let target = allJsx.find((jsx) => {
    const start = jsx.getStart();
    const end = jsx.getEnd();
    return pos >= start && pos <= end;
  });

  if (!target) return null;

  // Find the style attribute's ObjectLiteralExpression
  for (const attr of target.getAttributes()) {
    if (attr.getKind() !== SyntaxKind.JsxAttribute) continue;
    const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute)!;
    if (jsxAttr.getNameNode().getText() !== 'style') continue;

    const init = jsxAttr.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.JsxExpression) continue;
    const expr = init.asKind(SyntaxKind.JsxExpression)!.getExpression();
    if (!expr || expr.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

    const objLiteral = expr.asKind(SyntaxKind.ObjectLiteralExpression)!;
    const props = extractPropertyMap(objLiteral);
    const styleAttr = buildStyleAttrData(objLiteral, props);

    return addOrModifyPropertyEdit(styleAttr, propName, value);
  }

  // No style attribute found — cannot edit (adding style={{}} is out of scope for v1)
  return null;
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
