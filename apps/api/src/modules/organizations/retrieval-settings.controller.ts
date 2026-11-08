import type { RequestHandler } from 'express';
import { RetrievalSettingsResponseSchema, UpdateRetrievalSettingsSchema } from '@orgmind/shared';
import { env } from '../../config/env.js';
import { retrievalSettingsRepository } from './retrieval-settings.repository.js';

function organizationIdFromRequest(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function response(rerankingEnabled: boolean, queryRewriteEnabled: boolean) {
  return RetrievalSettingsResponseSchema.parse({
    rerankingEnabled,
    queryRewriteEnabled,
    rerankerAvailable: Boolean(env.COHERE_API_KEY),
  });
}

export const getRetrievalSettingsController: RequestHandler = async (req, res) => {
  const organizationId = organizationIdFromRequest(req.params.organizationId);
  if (!organizationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Organization is required.' } });
    return;
  }
  const settings = await retrievalSettingsRepository.get(organizationId);
  res.json(response(settings.rerankingEnabled, settings.queryRewriteEnabled));
};

export const updateRetrievalSettingsController: RequestHandler = async (req, res) => {
  const organizationId = organizationIdFromRequest(req.params.organizationId);
  const parsed = UpdateRetrievalSettingsSchema.safeParse(req.body);
  if (!organizationId || !parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_RETRIEVAL_SETTINGS',
        message: 'Valid retrieval settings are required.',
      },
    });
    return;
  }
  if (parsed.data.rerankingEnabled && !env.COHERE_API_KEY) {
    res.status(409).json({
      error: {
        code: 'RERANKER_NOT_CONFIGURED',
        message: 'Set COHERE_API_KEY before enabling reranking.',
      },
    });
    return;
  }
  const settings = await retrievalSettingsRepository.update(organizationId, parsed.data);
  res.json(response(settings.rerankingEnabled, settings.queryRewriteEnabled));
};
