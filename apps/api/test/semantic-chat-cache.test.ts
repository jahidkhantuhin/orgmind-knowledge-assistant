import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from '../src/modules/chat/semantic-chat-cache.js';

describe('semantic chat cache similarity', () => {
  it('scores matching and related vectors by cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0.99, 0.1])).toBeGreaterThan(0.99);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('rejects vectors with different dimensions or no magnitude', () => {
    expect(cosineSimilarity([1], [1, 0])).toBeLessThan(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBeLessThan(0);
  });
});
