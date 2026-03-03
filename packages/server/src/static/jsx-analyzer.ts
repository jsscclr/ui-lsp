import { Project, SyntaxKind, type SourceFile, type JsxOpeningElement, type JsxSelfClosingElement } from 'ts-morph';
import type { ComponentInfo } from '@ui-ls/shared';

type JsxElement = JsxOpeningElement | JsxSelfClosingElement;

/**
 * Analyzes JSX/TSX files to find component information at a cursor position.
 * Maintains a ts-morph Project that tracks open files.
 */
export class JsxAnalyzer {
  private project: Project;
  private files = new Map<string, SourceFile>();

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        jsx: 4, // JsxEmit.ReactJSX
        target: 99, // ScriptTarget.Latest
        module: 99, // ModuleKind.ESNext
        strict: true,
      },
    });
  }

  /**
   * Update file contents (called on textDocument/didOpen and didChange).
   */
  updateFile(filePath: string, content: string): void {
    const existing = this.files.get(filePath);
    if (existing) {
      existing.replaceWithText(content);
    } else {
      const source = this.project.createSourceFile(filePath, content, { overwrite: true });
      this.files.set(filePath, source);
    }
  }

  getSourceFile(filePath: string): SourceFile | undefined {
    return this.files.get(filePath);
  }

  removeFile(filePath: string): void {
    const existing = this.files.get(filePath);
    if (existing) {
      this.project.removeSourceFile(existing);
      this.files.delete(filePath);
    }
  }

  /**
   * Find the JSX component at a given cursor position.
   * Returns ComponentInfo if the cursor is on a JSX element, null otherwise.
   */
  getComponentAt(filePath: string, line: number, column: number): ComponentInfo | null {
    const source = this.files.get(filePath);
    if (!source) return null;

    // ts-morph uses 1-based lines, 1-based columns
    const pos = source.compilerNode.getPositionOfLineAndCharacter(line, column);

    // Find JSX elements at this position
    const jsxOpening = source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
    const jsxSelfClosing = source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);

    const allJsx: JsxElement[] = [...jsxOpening, ...jsxSelfClosing];

    // Find the most specific (innermost) JSX element containing the cursor
    let best: JsxElement | null = null;
    let bestSize = Infinity;

    for (const jsx of allJsx) {
      const start = jsx.getStart();
      const end = jsx.getEnd();
      const size = end - start;
      if (pos >= start && pos <= end && size < bestSize) {
        best = jsx;
        bestSize = size;
      }
    }

    if (!best) return null;

    const tagName = best.getTagNameNode().getText();
    const startLine = best.getStartLineNumber();
    const startCol = best.getStartLinePos();

    // Extract props from attributes
    const props: Record<string, unknown> = {};
    for (const attr of best.getAttributes()) {
      if (attr.getKind() === SyntaxKind.JsxAttribute) {
        const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute)!;
        const name = jsxAttr.getNameNode().getText();
        const initializer = jsxAttr.getInitializer();

        if (!initializer) {
          // Boolean shorthand: <Comp disabled />
          props[name] = true;
        } else if (initializer.getKind() === SyntaxKind.StringLiteral) {
          props[name] = initializer.asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
        } else {
          // Expression: show source text for non-trivial values
          props[name] = initializer.getText();
        }
      }
    }

    return {
      name: tagName,
      filePath,
      line: startLine,
      column: startCol,
      props,
    };
  }
}
