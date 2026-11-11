import { describe, expect, it } from 'vitest';
import { evaluationDocumentId, goldenDataset, runEvaluation } from '../src/index.js';

describe('evaluation runner', () => {
  it('measures source recall and reciprocal rank for all retrieval variants', async () => {
    const organizationId = 'unit-test-workspace';
    const expectedIds = ['employee-handbook', 'it-access-policy'].map((key) =>
      evaluationDocumentId(organizationId, key),
    );
    const run = await runEvaluation({
      organizationId,
      modelId: 'mock',
      topK: 3,
      minimumRecallAtK: 0.8,
      maximumRerankRecallDrop: 0.1,
      id: '11111111-1111-4111-8111-111111111111',
      now: new Date('2026-11-10T00:00:00.000Z'),
      adapter: {
        async retrieveAndAnswer(question, strategy) {
          const testCase = goldenDataset.find((item) => item.question === question)!;
          const expected = testCase.expectedSourceKeys.map((key) =>
            evaluationDocumentId(organizationId, key),
          );
          const sourceIds =
            strategy === 'vector'
              ? [...expectedIds.filter((id) => !expected.includes(id)), ...expected]
              : expected;
          return { answer: testCase.expectedAnswer, context: testCase.expectedAnswer, sourceIds };
        },
        async judge({ answer, expectedAnswer, context }) {
          const score = answer === expectedAnswer && context.includes(expectedAnswer) ? 1 : 0;
          return { groundedness: score, answerRelevance: score };
        },
      },
    });

    expect(run.passed).toBe(true);
    expect(run.variants).toHaveLength(4);
    expect(run.variants[0]?.metrics.recallAtK).toBe(1);
    expect(run.variants[0]?.metrics.mrr).toBe(0.5);
    expect(run.variants[1]?.metrics.mrr).toBe(1);
  });

  it('fails when hybrid retrieval falls below the configured recall threshold', async () => {
    const organizationId = 'unit-test-workspace';
    const run = await runEvaluation({
      organizationId,
      modelId: 'mock',
      topK: 3,
      minimumRecallAtK: 1,
      maximumRerankRecallDrop: 0.1,
      adapter: {
        async retrieveAndAnswer() {
          return { answer: '', context: '', sourceIds: [] };
        },
        async judge() {
          return { groundedness: 0, answerRelevance: 0 };
        },
      },
    });

    expect(run.passed).toBe(false);
  });
});
