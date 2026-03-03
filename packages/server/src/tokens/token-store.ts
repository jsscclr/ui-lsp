import { parseColor, colorToHex } from '../static/color-parser.js';

/** Subset of DTCG token type names supported for value matching in v1. */
export type TokenTypeName =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'duration'
  | 'number'
  | 'cubicBezier'
  | 'shadow'
  | 'border'
  | 'transition'
  | 'gradient'
  | 'typography';

export interface DesignToken {
  /** Dot-separated path, e.g. "colors.primary" */
  path: string;
  $type: TokenTypeName | undefined;
  /** Raw JSON value from the token file */
  $value: unknown;
  /** Normalized CSS string for matching, or null if type is unsupported for matching */
  cssValue: string | null;
  description?: string;
}

/**
 * In-memory store of design tokens with a reverse index for fast value lookups.
 *
 * Parses DTCG-format JSON, inheriting `$type` from parent groups,
 * and builds a `Map<cssValue, DesignToken[]>` so `findByValue()` is O(1).
 */
export class TokenStore {
  private tokens = new Map<string, DesignToken>();
  private valueLookup = new Map<string, DesignToken[]>();

  load(json: string): { warnings: string[] } {
    this.tokens.clear();
    this.valueLookup.clear();

    const doc: Record<string, unknown> = JSON.parse(json);
    const warnings: string[] = [];

    this.walkGroup(doc, [], undefined, warnings);

    return { warnings };
  }

  getTokens(type?: TokenTypeName): DesignToken[] {
    const all = [...this.tokens.values()];
    if (!type) return all;
    return all.filter((t) => t.$type === type);
  }

  findByValue(cssValue: string): DesignToken[] {
    return this.valueLookup.get(cssValue) ?? [];
  }

  get size(): number {
    return this.tokens.size;
  }

  private walkGroup(
    node: Record<string, unknown>,
    path: string[],
    inheritedType: TokenTypeName | undefined,
    warnings: string[],
  ): void {
    const groupType = (node.$type as TokenTypeName | undefined) ?? inheritedType;

    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      if (typeof value !== 'object' || value === null) continue;

      const childPath = [...path, key];
      const record = value as Record<string, unknown>;

      if ('$value' in record) {
        // It's a token
        const tokenType = (record.$type as TokenTypeName | undefined) ?? groupType;
        const cssValue = normalizeCssValue(record.$value, tokenType);
        const token: DesignToken = {
          path: childPath.join('.'),
          $type: tokenType,
          $value: record.$value,
          cssValue,
          ...(record.$description != null && { description: record.$description as string }),
        };

        this.tokens.set(token.path, token);

        if (cssValue !== null) {
          const existing = this.valueLookup.get(cssValue);
          if (existing) {
            existing.push(token);
          } else {
            this.valueLookup.set(cssValue, [token]);
          }
        }
      } else {
        // It's a group — recurse
        this.walkGroup(record, childPath, groupType, warnings);
      }
    }
  }
}

/**
 * Normalize a token's $value into a canonical CSS string for reverse-index matching.
 * Returns null for composite types (shadow, border, etc.) that we skip in v1.
 */
function normalizeCssValue(
  value: unknown,
  type: TokenTypeName | undefined,
): string | null {
  switch (type) {
    case 'color': {
      if (typeof value !== 'string') return null;
      const parsed = parseColor(value);
      return parsed ? colorToHex(parsed) : null;
    }
    case 'dimension': {
      if (typeof value === 'string') return value.toLowerCase().trim();
      if (typeof value === 'number') return `${value}px`;
      return null;
    }
    case 'fontWeight': {
      if (typeof value === 'number' || typeof value === 'string') return String(value);
      return null;
    }
    case 'fontFamily': {
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.map((f) => `"${f}"`).join(', ');
      return null;
    }
    case 'duration': {
      if (typeof value === 'string') return value.toLowerCase().trim();
      return null;
    }
    default:
      // number, cubicBezier, shadow, border, typography, etc. — skip matching in v1
      return null;
  }
}
