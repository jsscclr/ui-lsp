import type { TextEdit, Position } from 'vscode-languageserver';
import type { StyleAttrData } from '../diagnostics/diagnostic-data.js';

/**
 * Insert a new property before the closing `}` of the style object literal.
 * Produces: `, propName: value` (or `propName: value` if the object is empty).
 */
export function addPropertyEdit(
  styleAttr: StyleAttrData,
  propName: string,
  value: string,
): TextEdit {
  // Insert just before the closing `}`
  const insertPos = beforeClosingBrace(styleAttr);
  const hasProps = styleAttr.existingProps.length > 0;
  const newText = hasProps ? `, ${propName}: ${value}` : `${propName}: ${value} `;
  return { range: { start: insertPos, end: insertPos }, newText };
}

/**
 * Replace an existing property's value (keeps the key, replaces initializer).
 * Falls back to addPropertyEdit if the property doesn't exist.
 */
export function modifyPropertyEdit(
  styleAttr: StyleAttrData,
  propName: string,
  newValue: string,
): TextEdit | null {
  const prop = styleAttr.existingProps.find((p) => p.name === propName);
  if (!prop) return null;

  // Replace the entire property assignment (name: value) with new value
  return {
    range: prop.range,
    newText: `${propName}: ${newValue}`,
  };
}

/**
 * Add property if absent, modify if present.
 */
export function addOrModifyPropertyEdit(
  styleAttr: StyleAttrData,
  propName: string,
  value: string,
): TextEdit {
  const existing = modifyPropertyEdit(styleAttr, propName, value);
  if (existing) return existing;
  return addPropertyEdit(styleAttr, propName, value);
}

/**
 * Remove a property and its trailing/leading comma.
 */
export function removePropertyEdit(
  styleAttr: StyleAttrData,
  propName: string,
): TextEdit | null {
  const idx = styleAttr.existingProps.findIndex((p) => p.name === propName);
  if (idx === -1) return null;

  const prop = styleAttr.existingProps[idx];
  const isOnly = styleAttr.existingProps.length === 1;

  if (isOnly) {
    // Remove contents between { and }, leaving `{}`
    const start = afterOpeningBrace(styleAttr);
    const end = beforeClosingBrace(styleAttr);
    return { range: { start, end }, newText: '' };
  }

  // For multi-property objects, extend the range to eat the comma and whitespace.
  // If it's the last prop, eat the leading comma; otherwise eat the trailing comma.
  const isLast = idx === styleAttr.existingProps.length - 1;

  if (isLast) {
    // Eat from the end of the previous property to the end of this one
    const prev = styleAttr.existingProps[idx - 1];
    return { range: { start: prev.range.end, end: prop.range.end }, newText: '' };
  }

  // Eat from the start of this property to the start of the next one
  const next = styleAttr.existingProps[idx + 1];
  return { range: { start: prop.range.start, end: next.range.start }, newText: '' };
}

/** Position just inside the opening `{` (one character after objLiteralStart). */
function afterOpeningBrace(styleAttr: StyleAttrData): Position {
  return {
    line: styleAttr.objLiteralStart.line,
    character: styleAttr.objLiteralStart.character + 1,
  };
}

/** Position just before the closing `}` (one character before objLiteralEnd). */
function beforeClosingBrace(styleAttr: StyleAttrData): Position {
  return {
    line: styleAttr.objLiteralEnd.line,
    character: styleAttr.objLiteralEnd.character - 1,
  };
}
