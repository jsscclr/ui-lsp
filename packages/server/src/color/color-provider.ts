import type {
  ColorInformation,
  ColorPresentation,
  DocumentColorParams,
  ColorPresentationParams,
} from 'vscode-languageserver';
import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { JsxAnalyzer } from '../static/jsx-analyzer.js';
import {
  parseColor,
  extractColorFromShorthand,
  colorToHex,
  colorToRgb,
  COLOR_PROPERTIES,
  SHORTHAND_COLOR_PROPERTIES,
  type LspColor,
} from '../static/color-parser.js';

export class ColorProvider {
  private jsxAnalyzer: JsxAnalyzer;

  constructor(jsxAnalyzer: JsxAnalyzer) {
    this.jsxAnalyzer = jsxAnalyzer;
  }

  onDocumentColor(params: DocumentColorParams): ColorInformation[] {
    const filePath = uriToPath(params.textDocument.uri);
    const source = this.jsxAnalyzer.getSourceFile(filePath);
    if (!source) return [];

    return findColors(source);
  }

  onColorPresentation(params: ColorPresentationParams): ColorPresentation[] {
    const hex = colorToHex(params.color);
    const rgb = colorToRgb(params.color);

    return [
      { label: hex },
      { label: rgb },
    ];
  }
}

function findColors(source: SourceFile): ColorInformation[] {
  const results: ColorInformation[] = [];

  const allJsx = [
    ...source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const jsx of allJsx) {
    for (const attr of jsx.getAttributes()) {
      if (attr.getKind() !== SyntaxKind.JsxAttribute) continue;
      const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute)!;
      if (jsxAttr.getNameNode().getText() !== 'style') continue;

      const init = jsxAttr.getInitializer();
      if (!init || init.getKind() !== SyntaxKind.JsxExpression) continue;

      const expr = init.asKind(SyntaxKind.JsxExpression)!.getExpression();
      if (!expr || expr.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

      const objLiteral = expr.asKind(SyntaxKind.ObjectLiteralExpression)!;
      for (const prop of objLiteral.getProperties()) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const assignment = prop.asKind(SyntaxKind.PropertyAssignment)!;
        const propName = assignment.getName();
        const initializer = assignment.getInitializer();
        if (!initializer || initializer.getKind() !== SyntaxKind.StringLiteral) continue;

        const stringLiteral = initializer.asKind(SyntaxKind.StringLiteral)!;
        const value = stringLiteral.getLiteralValue();

        if (COLOR_PROPERTIES.has(propName)) {
          // Direct color property: parse the whole value
          const color = parseColor(value);
          if (color) {
            results.push(makeColorInfo(source, stringLiteral, color, value));
          }
        } else if (SHORTHAND_COLOR_PROPERTIES.has(propName)) {
          // Shorthand (e.g. border: '2px solid #3498db'): extract embedded color
          const extracted = extractColorFromShorthand(value);
          if (extracted) {
            results.push(
              makeShorthandColorInfo(source, stringLiteral, extracted),
            );
          }
        }
      }
    }
  }

  return results;
}

/**
 * Create ColorInformation for a direct color value like color: '#ff0000'.
 * The range covers the color string inside the quotes.
 */
function makeColorInfo(
  source: SourceFile,
  stringLiteral: { getStart(): number; getEnd(): number },
  color: LspColor,
  _value: string,
): ColorInformation {
  // String literal positions include the quotes — the color is between them
  const contentStart = stringLiteral.getStart() + 1; // skip opening quote
  const contentEnd = stringLiteral.getEnd() - 1;     // skip closing quote

  const startLC = source.compilerNode.getLineAndCharacterOfPosition(contentStart);
  const endLC = source.compilerNode.getLineAndCharacterOfPosition(contentEnd);

  return {
    range: {
      start: { line: startLC.line, character: startLC.character },
      end: { line: endLC.line, character: endLC.character },
    },
    color,
  };
}

/**
 * Create ColorInformation for a color embedded in a shorthand value.
 * The range covers only the color portion (e.g. '#3498db' within '2px solid #3498db').
 */
function makeShorthandColorInfo(
  source: SourceFile,
  stringLiteral: { getStart(): number },
  extracted: { color: LspColor; offset: number; length: number },
): ColorInformation {
  // +1 for opening quote, then offset into the string content
  const colorStart = stringLiteral.getStart() + 1 + extracted.offset;
  const colorEnd = colorStart + extracted.length;

  const startLC = source.compilerNode.getLineAndCharacterOfPosition(colorStart);
  const endLC = source.compilerNode.getLineAndCharacterOfPosition(colorEnd);

  return {
    range: {
      start: { line: startLC.line, character: startLC.character },
      end: { line: endLC.line, character: endLC.character },
    },
    color: extracted.color,
  };
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
