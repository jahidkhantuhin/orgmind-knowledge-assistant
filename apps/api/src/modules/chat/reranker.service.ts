import type { SimilarChunk } from '../documents/chunks.repository.js';
import { env } from '../../config/env.js';

export type RerankedChunk = SimilarChunk & {
  rerankRank: number;
  rerankScore: number;
};

export interface Reranker {
  readonly available: boolean;
  rerank(_query: string, _candidates: SimilarChunk[], _topN: number): Promise<RerankedChunk[]>;
}

type CohereRerankerOptions = {
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
};

type CohereResponse = { results?: Array<{ index?: number; relevance_score?: number }> };

export function createCohereReranker(options: CohereRerankerOptions): Reranker {
  return {
    available: options.apiKey.length > 0,
    async rerank(query, candidates, topN) {
      if (!options.apiKey) throw new Error('Cohere reranking is not configured.');
      if (candidates.length === 0) return [];
      const response = await (options.fetcher ?? fetch)('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          query,
          top_n: Math.min(topN, candidates.length),
          documents: candidates.map((candidate) =>
            [candidate.headingPath.join(' > '), candidate.text].filter(Boolean).join('\n'),
          ),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Cohere rerank request failed with HTTP ${response.status}.`);
      }
      const payload = (await response.json()) as CohereResponse;
      return (payload.results ?? []).flatMap((result, index) => {
        const candidateIndex = result.index;
        const candidate = typeof candidateIndex === 'number' ? candidates[candidateIndex] : null;
        const score = result.relevance_score;
        return candidate && typeof score === 'number' && Number.isFinite(score)
          ? [{ ...candidate, rerankRank: index + 1, rerankScore: score }]
          : [];
      });
    },
  };
}

export const reranker: Reranker = createCohereReranker({
  apiKey: env.COHERE_API_KEY,
  model: env.COHERE_RERANK_MODEL,
});
