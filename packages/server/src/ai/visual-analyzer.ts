import Anthropic from '@anthropic-ai/sdk';
import type { VisualAnalysis, VisualAnalysisSuggestion, ComputedStyles, InlineStyleInfo } from '@ui-ls/shared';

const MODEL = 'claude-haiku-4-5-20251001';
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 50;

interface CacheEntry {
  result: VisualAnalysis;
  timestamp: number;
}

export class VisualAnalyzer {
  private client: Anthropic;
  private cache = new Map<string, CacheEntry>();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async analyze(
    screenshot: string | null,
    componentName: string,
    computedStyles: ComputedStyles,
    inlineStyles: InlineStyleInfo[],
    tokenMatches: Record<string, string> | null,
  ): Promise<VisualAnalysis | null> {
    if (!screenshot) return null;

    const cacheKey = this.hashKey(screenshot, componentName);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.result, cached: true };
    }

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: screenshot },
            },
            {
              type: 'text',
              text: this.buildUserPrompt(componentName, computedStyles, inlineStyles, tokenMatches),
            },
          ],
        }],
      });

      const text = response.content[0];
      if (text.type !== 'text') return null;

      const parsed = JSON.parse(text.text) as {
        description?: string;
        suggestions?: VisualAnalysisSuggestion[];
      };

      if (typeof parsed.description !== 'string' || !Array.isArray(parsed.suggestions)) {
        return null;
      }

      const result: VisualAnalysis = {
        description: parsed.description,
        suggestions: parsed.suggestions,
        cached: false,
      };

      // Store in cache, evict oldest if full
      if (this.cache.size >= CACHE_MAX_SIZE) {
        const oldest = this.cache.keys().next().value!;
        this.cache.delete(oldest);
      }
      this.cache.set(cacheKey, { result, timestamp: Date.now() });

      return result;
    } catch {
      return null;
    }
  }

  private buildUserPrompt(
    componentName: string,
    computedStyles: ComputedStyles,
    inlineStyles: InlineStyleInfo[],
    tokenMatches: Record<string, string> | null,
  ): string {
    const lines = [`Component: <${componentName}>`];

    const styleEntries = Object.entries(computedStyles);
    if (styleEntries.length > 0) {
      lines.push('', 'Computed styles:');
      for (const [prop, val] of styleEntries) {
        const isInline = inlineStyles.some((s) => s.name === prop);
        lines.push(`  ${prop}: ${val}${isInline ? ' (inline)' : ''}`);
      }
    }

    if (tokenMatches && Object.keys(tokenMatches).length > 0) {
      lines.push('', 'Design token matches:');
      for (const [prop, token] of Object.entries(tokenMatches)) {
        lines.push(`  ${prop} → ${token}`);
      }
    }

    return lines.join('\n');
  }

  private hashKey(screenshot: string, componentName: string): string {
    return `${componentName}:${screenshot.slice(0, 64)}`;
  }
}

const SYSTEM_PROMPT = `You are a UI/UX reviewer for a React component inspector. You receive a screenshot of a single UI component along with its computed CSS styles and design token information.

Respond with a JSON object containing:
1. "description": A brief (1-2 sentence) visual description of the component.
2. "suggestions": An array of actionable suggestions. Each suggestion has:
   - "category": one of "ux", "accessibility", "design-system", "visual"
   - "severity": "info" or "warning"
   - "message": a concise, actionable suggestion
   - "property": (optional) the camelCase CSS property name this suggestion targets

Focus on:
- Accessibility: color contrast, touch target size (< 44px), text legibility
- Design system: values that don't match any design token, inconsistent spacing
- UX: visual hierarchy, readability, interactive affordances
- Visual: alignment issues, overflow, clipping

Keep suggestions specific and actionable. Only include genuine issues — do not pad with generic advice.
Respond with ONLY the JSON object, no markdown fences or extra text.`;
