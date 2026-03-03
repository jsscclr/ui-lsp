import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VisualAnalysis } from '@ui-ls/shared';

// Mock the SDK before importing
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { VisualAnalyzer } from '../visual-analyzer.js';

const FAKE_SCREENSHOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB';
const FAKE_RESPONSE: VisualAnalysis = {
  description: 'A blue button with white text',
  suggestions: [
    {
      category: 'accessibility',
      severity: 'warning',
      message: 'Color contrast ratio appears below 4.5:1',
      property: 'color',
    },
  ],
  cached: false,
};

describe('VisualAnalyzer', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns null when screenshot is absent', async () => {
    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(null, 'Button', {}, [], null);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Claude with screenshot and returns parsed analysis', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(FAKE_RESPONSE) }],
    });

    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(
      FAKE_SCREENSHOT, 'Button', { color: 'white' }, [], null,
    );

    expect(result).not.toBeNull();
    expect(result!.description).toBe('A blue button with white text');
    expect(result!.suggestions).toHaveLength(1);
    expect(result!.suggestions[0].category).toBe('accessibility');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Verify the image was sent
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toContain('haiku');
    const userMsg = call.messages[0];
    expect(userMsg.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image' }),
      ]),
    );
  });

  it('returns cached result for same screenshot + component', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(FAKE_RESPONSE) }],
    });

    const analyzer = new VisualAnalyzer('test-key');
    await analyzer.analyze(FAKE_SCREENSHOT, 'Button', {}, [], null);
    const cached = await analyzer.analyze(FAKE_SCREENSHOT, 'Button', {}, [], null);

    expect(mockCreate).toHaveBeenCalledTimes(1); // only one API call
    expect(cached!.cached).toBe(true);
  });

  it('returns null on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'));

    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(
      FAKE_SCREENSHOT, 'Button', {}, [], null,
    );
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    });

    const analyzer = new VisualAnalyzer('test-key');
    const result = await analyzer.analyze(
      FAKE_SCREENSHOT, 'Button', {}, [], null,
    );
    expect(result).toBeNull();
  });
});
