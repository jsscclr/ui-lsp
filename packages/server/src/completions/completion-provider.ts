import {
  CompletionItemKind,
  type CompletionItem,
  type CompletionParams,
} from 'vscode-languageserver';
import { SyntaxKind, type PropertyAssignment } from 'ts-morph';
import type { JsxAnalyzer } from '../static/jsx-analyzer.js';
import type { TokenStore } from '../tokens/token-store.js';
import { CSS_PROPERTY_TO_TOKEN_TYPE } from '../tokens/property-mapping.js';
import { findStyleObjects } from '../diagnostics/diagnostics-provider.js';

export class CompletionProvider {
  private jsxAnalyzer: JsxAnalyzer;
  private tokenStore: TokenStore | null = null;

  constructor(jsxAnalyzer: JsxAnalyzer) {
    this.jsxAnalyzer = jsxAnalyzer;
  }

  setTokenStore(store: TokenStore | null): void {
    this.tokenStore = store;
  }

  onCompletion(params: CompletionParams): CompletionItem[] {
    if (!this.tokenStore || this.tokenStore.size === 0) return [];

    const filePath = uriToPath(params.textDocument.uri);
    const source = this.jsxAnalyzer.getSourceFile(filePath);
    if (!source) return [];

    const offset = source.compilerNode.getPositionOfLineAndCharacter(
      params.position.line,
      params.position.character,
    );

    // Find which style object (if any) the cursor is in, and which property value
    for (const styleObj of findStyleObjects(source)) {
      const objStart = styleObj.getStart();
      const objEnd = styleObj.getEnd();
      if (offset < objStart || offset > objEnd) continue;

      // Check each property assignment to see if cursor is in a value position
      for (const prop of styleObj.getProperties()) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const assignment = prop.asKind(SyntaxKind.PropertyAssignment)!;
        const propName = assignment.getName();

        const tokenType = CSS_PROPERTY_TO_TOKEN_TYPE[propName];
        if (!tokenType) continue;

        if (isCursorInValuePosition(assignment, offset)) {
          return this.buildCompletions(tokenType);
        }
      }

      // Cursor is inside the style object but not in a recognized property value.
      // Could be typing a new property — no token completions in that case.
      break;
    }

    return [];
  }

  private buildCompletions(tokenType: string): CompletionItem[] {
    const tokens = this.tokenStore!.getTokens(tokenType as never);
    return tokens
      .filter((t) => t.cssValue !== null)
      .map((t) => ({
        label: t.path,
        detail: t.cssValue!,
        documentation: t.description,
        kind: tokenType === 'color' ? CompletionItemKind.Color : CompletionItemKind.Value,
        insertText: `'${t.cssValue}'`,
        sortText: `0${t.path}`,
        filterText: `${t.path} ${t.cssValue}`,
      }));
  }
}

/**
 * Check if `offset` falls within the value portion of a PropertyAssignment.
 * The value portion starts after the colon and extends to the end of the initializer.
 */
function isCursorInValuePosition(
  assignment: PropertyAssignment,
  offset: number,
): boolean {
  const initializer = assignment.getInitializer();
  if (!initializer) return false;

  // The colon separating name from value
  const colonToken = assignment.getFirstChildByKind(SyntaxKind.ColonToken);
  if (!colonToken) return false;

  const valueStart = colonToken.getEnd(); // right after ':'
  const valueEnd = initializer.getEnd();

  return offset >= valueStart && offset <= valueEnd;
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}
