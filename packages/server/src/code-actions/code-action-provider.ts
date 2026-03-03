import {
  type CodeAction,
  type CodeActionParams,
  CodeActionKind,
  TextDocumentEdit,
  TextEdit,
  VersionedTextDocumentIdentifier,
} from 'vscode-languageserver';
import type { DiagnosticData } from '../diagnostics/diagnostic-data.js';
import { generateFixes } from './fix-generator.js';

export class CodeActionProvider {
  onCodeAction(params: CodeActionParams): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of params.context.diagnostics) {
      const data = diagnostic.data as DiagnosticData | undefined;
      if (!data?.ruleId) continue;

      const fixes = generateFixes(data);
      for (const fix of fixes) {
        actions.push({
          title: fix.title,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          edit: {
            documentChanges: [
              TextDocumentEdit.create(
                VersionedTextDocumentIdentifier.create(params.textDocument.uri, null as unknown as number),
                fix.edits.map((e) => TextEdit.replace(e.range, e.newText)),
              ),
            ],
          },
        });
      }
    }

    return actions;
  }
}
