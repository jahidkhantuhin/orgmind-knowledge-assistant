import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { generateText } from 'ai';
import { z } from 'zod';
import {
  evaluationDocumentId,
  formatMarkdownReport,
  goldenDataset,
  runEvaluation,
} from '@orgmind/evals';
import type { ChatCitation, EvalStrategy } from '@orgmind/shared';
import { env } from '../src/config/env.js';
import { closeConnections } from '../src/lib/connections.js';
import { logger } from '../src/lib/logger.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { chatModelProvider } from '../src/modules/chat/chat-model.provider.js';
import {
  buildGroundedSystemPrompt,
  LOW_CONFIDENCE_ANSWER,
} from '../src/modules/chat/prompt.builder.js';
import { createEvaluationRetrievalService } from '../src/modules/chat/retrieval.service.js';
import { reranker } from '../src/modules/chat/reranker.service.js';
import { aclTokensForPrincipal } from '../src/modules/documents/document-acl.js';
import { documentsRepository } from '../src/modules/documents/documents.repository.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { membershipsRepository } from '../src/modules/organizations/memberships.repository.js';
import { evalRunsRepository } from '../src/modules/evals/eval-runs.repository.js';

const JudgeResponseSchema = z.object({
  groundedness: z.number().int().min(1).max(5),
  answerRelevance: z.number().int().min(1).max(5),
});

function parseJudgeResponse(text: string): z.infer<typeof JudgeResponseSchema> {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('The evaluation judge did not return valid JSON scores.');
  return JudgeResponseSchema.parse(JSON.parse(json));
}

let lastGeminiRequestAt = 0;

async function waitForGeminiRequestSlot(): Promise<void> {
  const intervalMs = env.EVAL_GEMINI_REQUEST_INTERVAL_MS;
  const waitMs = Math.max(0, lastGeminiRequestAt + intervalMs - Date.now());
  if (waitMs > 0) await delay(waitMs);
  lastGeminiRequestAt = Date.now();
}

async function judge(input: {
  question: string;
  expectedAnswer: string;
  answer: string;
  context: string;
}): Promise<{ groundedness: number; answerRelevance: number }> {
  await waitForGeminiRequestSlot();
  const result = await generateText({
    model: chatModelProvider.getModel(),
    temperature: 0,
    maxOutputTokens: 160,
    prompt: `You are evaluating a retrieval-augmented answer. Score each dimension from 1 to 5. Return only a JSON object with integer fields groundedness and answerRelevance. Groundedness measures whether the answer's factual claims are supported by the retrieved context. Answer relevance measures whether the answer addresses the question and matches the expected answer. Do not reward unsupported facts.

Question: ${input.question}
Expected answer (reference only): ${input.expectedAnswer}
Retrieved context:
${input.context.slice(0, 10_000) || '(no retrieved context)'}
Assistant answer:
${input.answer}`,
  });
  const scores = parseJudgeResponse(result.text);
  return { groundedness: scores.groundedness / 5, answerRelevance: scores.answerRelevance / 5 };
}

try {
  const organizationId = env.EVAL_ORGANIZATION_ID.trim();
  if (!organizationId)
    throw new Error('Set EVAL_ORGANIZATION_ID to a dedicated workspace ID in .env.');
  if (!env.GOOGLE_API_KEY) throw new Error('Set GOOGLE_API_KEY before running the evaluation.');
  if (!reranker.available) throw new Error('Set COHERE_API_KEY before comparing hybrid+rerank.');
  await runMigrations();
  const owner = await usersRepository.findByEmail(env.SEED_ADMIN_EMAIL);
  if (!owner) throw new Error('Run pnpm db:seed first to create the local admin account.');
  const membership = await membershipsRepository.findForUserInOrganization(
    owner.id,
    organizationId,
  );
  if (membership?.role !== 'admin') {
    throw new Error('The configured seed administrator must be an admin in EVAL_ORGANIZATION_ID.');
  }
  const expectedIds = [
    ...new Set(
      goldenDataset.flatMap((item) =>
        item.expectedSourceKeys.map((key) => evaluationDocumentId(organizationId, key)),
      ),
    ),
  ];
  const documents = await documentsRepository.findByIdsInOrganization(expectedIds, organizationId);
  if (
    documents.length !== expectedIds.length ||
    documents.some((document) => document.status !== 'parsed')
  ) {
    throw new Error(
      'Evaluation seed documents are missing or not ready. Run pnpm eval:seed first.',
    );
  }

  const aclTokens = aclTokensForPrincipal(owner.id, 'admin', membership.groupIds);
  const services: Record<EvalStrategy, ReturnType<typeof createEvaluationRetrievalService>> = {
    vector: createEvaluationRetrievalService('vector'),
    hybrid: createEvaluationRetrievalService('hybrid'),
    'hybrid-rerank': createEvaluationRetrievalService('hybrid-rerank'),
  };
  logger.info(
    { minimumIntervalMs: env.EVAL_GEMINI_REQUEST_INTERVAL_MS },
    'Pacing Gemini evaluation requests.',
  );
  const run = await runEvaluation({
    organizationId,
    modelId: env.CHAT_MODEL,
    topK: env.CHAT_TOP_K,
    minimumRecallAtK: env.EVAL_MIN_RECALL_AT_K,
    maximumRerankRecallDrop: env.EVAL_MAX_RERANK_RECALL_DROP,
    id: randomUUID(),
    adapter: {
      async retrieveAndAnswer(question, strategy) {
        const retrieval = await services[strategy].retrieve(question, organizationId, aclTokens);
        if (retrieval.citations.length) await waitForGeminiRequestSlot();
        const answer = retrieval.citations.length
          ? (
              await generateText({
                model: chatModelProvider.getModel(),
                system: buildGroundedSystemPrompt(retrieval.citations),
                prompt: `Retrieved passages:\n${retrieval.context}\n\nQuestion: ${question}`,
                temperature: 0.2,
                maxOutputTokens: 350,
              })
            ).text
          : LOW_CONFIDENCE_ANSWER;
        const citations: ChatCitation[] = retrieval.citations;
        return {
          answer,
          context: retrieval.context,
          sourceIds: [...new Set(citations.map((citation) => citation.documentId))],
        };
      },
      judge,
    },
  });

  await evalRunsRepository.create(run);
  const reportDirectory = resolve(process.cwd(), '../../packages/evals/reports');
  await mkdir(reportDirectory, { recursive: true });
  const basename = `eval-${run.createdAt.toISOString().replaceAll(':', '-')}-${run._id}`;
  await Promise.all([
    writeFile(resolve(reportDirectory, `${basename}.json`), `${JSON.stringify(run, null, 2)}\n`),
    writeFile(resolve(reportDirectory, `${basename}.md`), formatMarkdownReport(run)),
  ]);
  for (const variant of run.variants) {
    logger.info(
      { strategy: variant.strategy, metrics: variant.metrics },
      'Evaluation strategy results',
    );
  }
  logger.info(
    { passed: run.passed, report: basename },
    run.passed ? 'Evaluation passed.' : 'Evaluation regression threshold failed.',
  );
  if (!run.passed) process.exitCode = 1;
} catch (error) {
  logger.error({ err: error }, 'Evaluation run failed.');
  process.exitCode = 1;
} finally {
  await closeConnections();
}
