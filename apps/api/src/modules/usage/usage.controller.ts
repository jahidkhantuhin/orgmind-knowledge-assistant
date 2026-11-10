import type { RequestHandler } from 'express';
import { UsageSummaryResponseSchema } from '@orgmind/shared';
import { usageRepository } from './usage.repository.js';

export const getOrganizationUsageController: RequestHandler = async (req, res) => {
  const value = req.params.organizationId;
  const organizationId = Array.isArray(value) ? value[0] : value;
  if (!organizationId) {
    res.status(400).json({
      error: { code: 'INVALID_ORGANIZATION', message: 'Workspace is required.' },
    });
    return;
  }
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  since.setUTCHours(0, 0, 0, 0);
  const { totals, daily } = await usageRepository.summarize(organizationId, since);
  res.json(
    UsageSummaryResponseSchema.parse({
      usage: {
        since: since.toISOString(),
        requests: totals.requests,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        totalTokens: totals.totalTokens,
        estimatedCostUsd: totals.estimatedCostUsd,
        averageLatencyMs: {
          retrieval: totals.retrieval,
          embedding: totals.embedding,
          search: totals.search,
          rerank: totals.rerank,
          generation: totals.generation,
          total: totals.total,
        },
        daily,
      },
    }),
  );
};
