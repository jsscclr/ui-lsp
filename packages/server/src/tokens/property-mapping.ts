import type { TokenTypeName } from './token-store.js';

/**
 * Maps camelCase CSS property names (as written in React inline styles)
 * to the DTCG token type that governs their values.
 *
 * Properties not in this map are not matched against the token store.
 */
export const CSS_PROPERTY_TO_TOKEN_TYPE: Record<string, TokenTypeName> = {
  // Colors
  color: 'color',
  backgroundColor: 'color',
  borderColor: 'color',
  borderTopColor: 'color',
  borderRightColor: 'color',
  borderBottomColor: 'color',
  borderLeftColor: 'color',
  outlineColor: 'color',
  textDecorationColor: 'color',
  fill: 'color',
  stroke: 'color',

  // Dimensions
  width: 'dimension',
  height: 'dimension',
  minWidth: 'dimension',
  minHeight: 'dimension',
  maxWidth: 'dimension',
  maxHeight: 'dimension',
  padding: 'dimension',
  paddingTop: 'dimension',
  paddingRight: 'dimension',
  paddingBottom: 'dimension',
  paddingLeft: 'dimension',
  margin: 'dimension',
  marginTop: 'dimension',
  marginRight: 'dimension',
  marginBottom: 'dimension',
  marginLeft: 'dimension',
  gap: 'dimension',
  rowGap: 'dimension',
  columnGap: 'dimension',
  fontSize: 'dimension',
  borderRadius: 'dimension',
  borderWidth: 'dimension',
  top: 'dimension',
  right: 'dimension',
  bottom: 'dimension',
  left: 'dimension',

  // Font
  fontFamily: 'fontFamily',
  fontWeight: 'fontWeight',

  // Duration
  transitionDuration: 'duration',
  animationDuration: 'duration',
};
