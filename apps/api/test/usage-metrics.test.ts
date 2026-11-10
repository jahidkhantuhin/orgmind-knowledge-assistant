import { describe, expect, it } from 'vitest';
import { estimateTokenCostUsd } from '../src/modules/chat/usage-metrics.js';

describe('chat usage metrics', () => {
  it('estimates Gemini paid-list cost from input and output token counts', () => {
    expect(estimateTokenCostUsd(1_000_000, 1_000_000, 0.3, 2.5)).toBe(2.8);
  });

  it('returns zero for no generated tokens', () => {
    expect(estimateTokenCostUsd(0, 0, 0.3, 2.5)).toBe(0);
  });
});
