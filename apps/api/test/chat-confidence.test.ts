import { describe, expect, it } from 'vitest';
import { isLowConfidenceAnswer } from '../src/modules/chat/chat-confidence.js';
import { LOW_CONFIDENCE_ANSWER } from '../src/modules/chat/prompt.builder.js';

describe('low-confidence answer detection', () => {
  it('flags an explicit no-answer response even when retrieval found candidate citations', () => {
    expect(
      isLowConfidenceAnswer({
        retrievalHadNoCitations: false,
        usedCitationCount: 0,
        answer: LOW_CONFIDENCE_ANSWER,
      }),
    ).toBe(true);
  });

  it('flags answers that do not cite retrieved evidence', () => {
    expect(
      isLowConfidenceAnswer({
        retrievalHadNoCitations: false,
        usedCitationCount: 0,
        answer: 'I cannot find this in the documents.',
      }),
    ).toBe(true);
  });

  it('keeps a sourced answer out of the knowledge gaps list', () => {
    expect(
      isLowConfidenceAnswer({
        retrievalHadNoCitations: false,
        usedCitationCount: 1,
        answer: 'Employees receive 10 days of leave [S1].',
      }),
    ).toBe(false);
  });
});
