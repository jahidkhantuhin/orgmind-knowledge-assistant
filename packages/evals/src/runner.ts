import { randomUUID } from 'node:crypto';
import {
  EvalRunDocumentSchema,
  type EvalCaseResult,
  type EvalMetrics,
  type EvalRunDocument,
  type EvalStrategy,
  type EvalVariantResult,
} from '@orgmind/shared';
import { evaluationDocumentId, goldenDataset } from './dataset.js';

export const EVAL_STRATEGIES: EvalStrategy[] = ['vector', 'hybrid', 'hybrid-rerank', 'agentic'];

export type EvaluationAdapter = {
  retrieveAndAnswer(
    _question: string,
    _strategy: EvalStrategy,
  ): Promise<{ answer: string; context: string; sourceIds: string[] }>;
  judge(_input: {
    question: string;
    expectedAnswer: string;
    answer: string;
    context: string;
  }): Promise<{ groundedness: number; answerRelevance: number }>;
};

function average(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function retrievalMetrics(expectedSourceIds: string[], retrievedSourceIds: string[]) {
  const expected = new Set(expectedSourceIds);
  const relevantRanks = retrievedSourceIds.flatMap((sourceId, index) =>
    expected.has(sourceId) ? [index + 1] : [],
  );
  const recallAtK = expected.size
    ? new Set(retrievedSourceIds.filter((sourceId) => expected.has(sourceId))).size / expected.size
    : 1;
  return { recallAtK, mrr: relevantRanks.length ? 1 / relevantRanks[0]! : 0 };
}

function averageMetrics(cases: EvalCaseResult[]): EvalMetrics {
  return {
    recallAtK: average(cases.map((item) => item.metrics.recallAtK)),
    mrr: average(cases.map((item) => item.metrics.mrr)),
    groundedness: average(cases.map((item) => item.metrics.groundedness)),
    answerRelevance: average(cases.map((item) => item.metrics.answerRelevance)),
  };
}

export async function runEvaluation(input: {
  organizationId: string;
  modelId: string;
  topK: number;
  minimumRecallAtK: number;
  maximumRerankRecallDrop: number;
  adapter: EvaluationAdapter;
  now?: Date;
  id?: string;
}): Promise<EvalRunDocument> {
  const variants: EvalVariantResult[] = [];
  for (const strategy of EVAL_STRATEGIES) {
    const cases: EvalCaseResult[] = [];
    for (const goldenCase of goldenDataset) {
      const retrieved = await input.adapter.retrieveAndAnswer(goldenCase.question, strategy);
      const expectedSourceIds = goldenCase.expectedSourceKeys.map((key) =>
        evaluationDocumentId(input.organizationId, key),
      );
      const retrieval = retrievalMetrics(expectedSourceIds, retrieved.sourceIds);
      const judged = await input.adapter.judge({
        question: goldenCase.question,
        expectedAnswer: goldenCase.expectedAnswer,
        answer: retrieved.answer,
        context: retrieved.context,
      });
      cases.push({
        caseId: goldenCase.id,
        question: goldenCase.question,
        expectedAnswer: goldenCase.expectedAnswer,
        answer: retrieved.answer,
        expectedSourceIds,
        retrievedSourceIds: retrieved.sourceIds,
        metrics: {
          ...retrieval,
          groundedness: Math.max(0, Math.min(1, judged.groundedness)),
          answerRelevance: Math.max(0, Math.min(1, judged.answerRelevance)),
        },
      });
    }
    variants.push({ strategy, metrics: averageMetrics(cases), cases });
  }

  const hybrid = variants.find((variant) => variant.strategy === 'hybrid')!;
  const reranked = variants.find((variant) => variant.strategy === 'hybrid-rerank')!;
  const agentic = variants.find((variant) => variant.strategy === 'agentic')!;
  const passed =
    hybrid.metrics.recallAtK >= input.minimumRecallAtK &&
    agentic.metrics.recallAtK >= input.minimumRecallAtK &&
    reranked.metrics.recallAtK >= input.minimumRecallAtK &&
    reranked.metrics.recallAtK >= hybrid.metrics.recallAtK - input.maximumRerankRecallDrop;

  return EvalRunDocumentSchema.parse({
    _id: input.id ?? randomUUID(),
    organizationId: input.organizationId,
    createdAt: input.now ?? new Date(),
    modelId: input.modelId,
    topK: input.topK,
    minimumRecallAtK: input.minimumRecallAtK,
    maximumRerankRecallDrop: input.maximumRerankRecallDrop,
    passed,
    variants,
  });
}

export function formatMarkdownReport(run: EvalRunDocument): string {
  const lines = [
    '# OrgMind evaluation report',
    '',
    `- Run: ${run._id}`,
    `- Created: ${run.createdAt.toISOString()}`,
    `- Model: ${run.modelId}`,
    `- Top K: ${run.topK}`,
    `- Result: **${run.passed ? 'PASSED' : 'FAILED'}**`,
    '',
    '| Strategy | Recall@K | MRR | Groundedness | Answer relevance |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const variant of run.variants) {
    const { metrics } = variant;
    lines.push(
      `| ${variant.strategy} | ${metrics.recallAtK.toFixed(3)} | ${metrics.mrr.toFixed(3)} | ${metrics.groundedness.toFixed(3)} | ${metrics.answerRelevance.toFixed(3)} |`,
    );
  }
  lines.push(
    '',
    `Regression threshold: hybrid and agentic Recall@K ≥ ${run.minimumRecallAtK.toFixed(2)}; hybrid+rerank may drop no more than ${run.maximumRerankRecallDrop.toFixed(2)} vs hybrid.`,
    '',
  );
  return lines.join('\n');
}
