import type { TextEdit } from 'vscode-languageserver';
import type { DiagnosticData } from '../diagnostics/diagnostic-data.js';
import {
  addPropertyEdit,
  addOrModifyPropertyEdit,
  removePropertyEdit,
} from './style-edit-utils.js';

export interface FixSuggestion {
  title: string;
  edits: TextEdit[];
}

/**
 * Given a diagnostic's data, produce zero or more quick-fix suggestions.
 * Returns [] when the diagnostic has no style attribute (nothing to edit)
 * or the rule is unrecognized.
 */
export function generateFixes(data: DiagnosticData): FixSuggestion[] {
  const handler = fixHandlers[data.ruleId];
  if (!handler) return [];
  return handler(data);
}

type FixHandler = (data: DiagnosticData) => FixSuggestion[];

const fixHandlers: Record<string, FixHandler> = {
  'flex-without-display': (data) => {
    if (!data.styleAttr) return [];
    return [{
      title: "Add display: 'flex'",
      edits: [addPropertyEdit(data.styleAttr, 'display', "'flex'")],
    }];
  },

  'width-with-flex': (data) => {
    if (!data.styleAttr) return [];
    const edit = removePropertyEdit(data.styleAttr, 'width');
    if (!edit) return [];
    return [{
      title: "Remove 'width'",
      edits: [edit],
    }];
  },

  'conflicting-dimensions': (data) => {
    if (!data.styleAttr) return [];
    const { minName } = data.fixContext as { dimName: string; minName: string };
    const edit = removePropertyEdit(data.styleAttr, minName);
    if (!edit) return [];
    return [{
      title: `Remove '${minName}'`,
      edits: [edit],
    }];
  },

  'zero-size': (data) => {
    if (!data.styleAttr) return [];
    return [{
      title: 'Add width: 100, height: 100 (placeholder)',
      edits: [
        addOrModifyPropertyEdit(data.styleAttr, 'width', '100'),
        addOrModifyPropertyEdit(data.styleAttr, 'height', '100'),
      ],
    }];
  },

  'overflow': (data) => {
    if (!data.styleAttr) return [];
    return [
      {
        title: "Add overflow: 'hidden'",
        edits: [addOrModifyPropertyEdit(data.styleAttr, 'overflow', "'hidden'")],
      },
      {
        title: "Add overflow: 'auto'",
        edits: [addOrModifyPropertyEdit(data.styleAttr, 'overflow', "'auto'")],
      },
    ];
  },

  'invisible': (data) => {
    if (!data.styleAttr) return [];
    const { hidingProp } = data.fixContext as { hidingProp: string };
    const edit = removePropertyEdit(data.styleAttr, hidingProp);
    if (!edit) return [];
    return [{
      title: `Remove '${hidingProp}'`,
      edits: [edit],
    }];
  },

  'clipped-text': (data) => {
    if (!data.styleAttr) return [];
    const fixes: FixSuggestion[] = [
      {
        title: "Add overflow: 'visible'",
        edits: [addOrModifyPropertyEdit(data.styleAttr, 'overflow', "'visible'")],
      },
    ];
    const removeEllipsis = removePropertyEdit(data.styleAttr, 'textOverflow');
    if (removeEllipsis) {
      fixes.push({
        title: "Remove 'textOverflow'",
        edits: [removeEllipsis],
      });
    }
    return fixes;
  },
};
