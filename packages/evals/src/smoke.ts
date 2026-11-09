import { evaluationDocumentId, goldenDataset, runEvaluation } from './index.js';

const organizationId = 'smoke-eval-organization';
const expectedSourceIds = new Set(
  ['employee-handbook', 'it-access-policy'].map((key) => evaluationDocumentId(organizationId, key)),
);
const run = await runEvaluation({
  organizationId,
  modelId: 'deterministic-smoke',
  topK: 5,
  minimumRecallAtK: 0.8,
  maximumRerankRecallDrop: 0.1,
  adapter: {
    async retrieveAndAnswer(question, strategy) {
      const golden = goldenDataset.find((item) => item.question === question)!;
      const expected = golden.expectedSourceKeys.map((key) =>
        evaluationDocumentId(organizationId, key),
      );
      const sourceIds =
        strategy === 'vector'
          ? [...expected, ...[...expectedSourceIds].filter((id) => !expected.includes(id))]
          : [...expected, ...[...expectedSourceIds].filter((id) => !expected.includes(id))];
      return { answer: golden.expectedAnswer, context: golden.expectedAnswer, sourceIds };
    },
    async judge({ expectedAnswer, answer, context }) {
      const grounded = context.includes(expectedAnswer) && answer === expectedAnswer;
      return { groundedness: grounded ? 1 : 0, answerRelevance: answer === expectedAnswer ? 1 : 0 };
    },
  },
});

if (!run.passed) throw new Error('Evaluation smoke regression threshold failed.');
console.log('Evaluation smoke check passed.');
for (const variant of run.variants) {
  console.log(`${variant.strategy}: Recall@K ${variant.metrics.recallAtK.toFixed(2)}`);
}
