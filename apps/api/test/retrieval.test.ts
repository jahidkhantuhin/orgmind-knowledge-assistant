import { describe, expect, it, vi } from 'vitest';
import {
  createConfiguredRetrievalService,
  createVectorRetrievalService,
} from '../src/modules/chat/retrieval.service.js';

describe('vector retrieval service', () => {
  it('embeds the query, searches within the organization, filters weak matches, and builds citations', async () => {
    const embed = vi.fn(async (_query: string) => [0.25, 0.75]);
    const search = vi.fn(async () => [
      {
        _id: 'chunk-1',
        documentId: '00000000-0000-4000-8000-000000000001',
        chunkIndex: 2,
        text: 'The team retains invoices for seven years.',
        headingPath: ['Finance', 'Retention'],
        score: 0.91,
      },
      {
        _id: 'chunk-2',
        documentId: '00000000-0000-4000-8000-000000000002',
        chunkIndex: 0,
        text: 'Weak result',
        headingPath: [],
        score: 0.3,
      },
    ]);
    const findDocuments = vi.fn(async () => [
      {
        _id: '00000000-0000-4000-8000-000000000001',
        originalName: 'Finance policy.pdf',
      },
    ]);
    const service = createVectorRetrievalService({
      embed,
      search,
      findDocuments,
      limit: 5,
      minimumScore: 0.45,
    });

    const result = await service.retrieve('How long are invoices retained?', 'org-1');

    expect(embed).toHaveBeenCalledWith('How long are invoices retained?');
    expect(search).toHaveBeenCalledWith([0.25, 0.75], 'org-1', 5);
    expect(findDocuments).toHaveBeenCalledWith(['00000000-0000-4000-8000-000000000001'], 'org-1');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      documentName: 'Finance policy.pdf',
      chunkIndex: 2,
      score: 0.91,
    });
    expect(result.context).toContain('[S1] Finance policy.pdf — Finance / Retention');
  });

  it('returns no citations when there are no matches above the confidence threshold', async () => {
    const service = createVectorRetrievalService({
      embed: async () => [1],
      search: async () => [
        {
          _id: 'chunk-1',
          documentId: '00000000-0000-4000-8000-000000000001',
          chunkIndex: 0,
          text: 'Unrelated',
          headingPath: [],
          score: 0.2,
        },
      ],
      findDocuments: async () => [],
      limit: 5,
      minimumScore: 0.45,
    });

    await expect(service.retrieve('A question', 'org-1')).resolves.toEqual({
      citations: [],
      debug: [],
      context: '',
    });
  });

  it('uses the configured hybrid strategy and returns per-chunk retrieval details', async () => {
    const hybridSearch = vi.fn(async () => [
      {
        _id: 'chunk-hybrid',
        documentId: '00000000-0000-4000-8000-000000000003',
        chunkIndex: 4,
        text: 'The policy retains invoices for seven years.',
        headingPath: ['Finance'],
        score: 0.02,
        retrievalDebug: {
          vectorRank: 2,
          vectorScore: 0.87,
          keywordRank: 1,
          keywordScore: 3.4,
          fusedScore: 0.02,
        },
      },
    ]);
    const service = createConfiguredRetrievalService({
      embed: async () => [0.1, 0.9],
      search: async () => [],
      hybridSearch,
      findDocuments: async () => [
        {
          _id: '00000000-0000-4000-8000-000000000003',
          originalName: 'Finance policy.pdf',
        },
      ],
      limit: 5,
      minimumScore: 0.45,
      strategy: 'hybrid',
      weights: { vector: 0.7, keyword: 0.3 },
    });

    const result = await service.retrieve('invoice retention', 'org-1');

    expect(hybridSearch).toHaveBeenCalledWith('invoice retention', [0.1, 0.9], 'org-1', 5, {
      vector: 0.7,
      keyword: 0.3,
    });
    expect(result.debug).toEqual([
      {
        chunkId: 'chunk-hybrid',
        documentName: 'Finance policy.pdf',
        chunkIndex: 4,
        fusedRank: 1,
        vectorRank: 2,
        vectorScore: 0.87,
        keywordRank: 1,
        keywordScore: 3.4,
        fusedScore: 0.02,
      },
    ]);
  });

  it('keeps the fused search results when the optional reranker request fails', async () => {
    const service = createConfiguredRetrievalService({
      embed: async () => [1, 0],
      search: async () => [],
      hybridSearch: async () => [
        {
          _id: 'chunk-fallback',
          documentId: '00000000-0000-4000-8000-000000000004',
          chunkIndex: 1,
          text: 'The handbook allows ten paid sick days.',
          headingPath: ['Leave'],
          score: 0.02,
          retrievalDebug: {
            vectorRank: 1,
            vectorScore: 0.82,
            keywordRank: 1,
            keywordScore: 0.24,
            fusedScore: 0.02,
          },
        },
      ],
      findDocuments: async () => [
        {
          _id: '00000000-0000-4000-8000-000000000004',
          originalName: 'Handbook.pdf',
        },
      ],
      limit: 1,
      candidateCount: 5,
      minimumScore: 0.45,
      strategy: 'hybrid',
      getSettings: async () => ({ rerankingEnabled: true, queryRewriteEnabled: false }),
      reranker: {
        available: true,
        rerank: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
      },
    });

    const result = await service.retrieve('sick leave', 'org-1');

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.documentName).toBe('Handbook.pdf');
    expect(result.debug[0]?.rerankRank).toBeUndefined();
  });
});
