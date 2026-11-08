import { describe, expect, it, vi } from 'vitest';
import { createContextualEnrichmentService } from '../src/modules/documents/contextual-enrichment.service.js';
import type { TextChunk } from '../src/modules/documents/chunking.service.js';
import { createQueryRewritingService } from '../src/modules/chat/query-rewriting.service.js';
import { createCohereReranker } from '../src/modules/chat/reranker.service.js';

const sampleChunk: TextChunk = {
  chunkIndex: 0,
  text: 'The leave policy grants ten paid sick days each year.',
  headingPath: ['People', 'Sick leave'],
  startOffset: 0,
  endOffset: 52,
};

describe('retrieval enhancements', () => {
  it('uses Cohere results to rerank candidates and attaches their relevance scores', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'rerank-v5.0-fast',
        query: 'sick leave',
        top_n: 2,
      });
      return new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.91 },
            { index: 0, relevance_score: 0.42 },
          ],
        }),
        { status: 200 },
      );
    });
    const service = createCohereReranker({
      apiKey: 'test-key',
      model: 'rerank-v5.0-fast',
      fetcher: fetcher as typeof fetch,
    });
    const candidates = [
      {
        _id: 'first',
        documentId: 'doc-1',
        chunkIndex: 0,
        text: 'Annual leave has 20 days.',
        headingPath: [],
        score: 0.02,
      },
      {
        _id: 'second',
        documentId: 'doc-2',
        chunkIndex: 1,
        text: 'Ten sick days are granted annually.',
        headingPath: [],
        score: 0.01,
      },
    ];

    await expect(service.rerank('sick leave', candidates, 2)).resolves.toMatchObject([
      { _id: 'second', rerankRank: 1, rerankScore: 0.91 },
      { _id: 'first', rerankRank: 2, rerankScore: 0.42 },
    ]);
  });

  it('caches generated chunk context and prepends it before embedding text', async () => {
    const records = new Map<
      string,
      {
        _id: string;
        organizationId: string;
        documentId: string;
        chunkIndex: number;
        context: string;
        createdAt: Date;
        expiresAt: Date;
      }
    >();
    const generateContext = vi.fn(
      async () => 'This passage describes the annual sick leave allowance.',
    );
    const service = createContextualEnrichmentService({
      enabled: true,
      model: 'gemini-test',
      ttlDays: 180,
      findMany: async (ids) => ids.flatMap((id) => (records.has(id) ? [records.get(id)!] : [])),
      save: async (record) => void records.set(record._id, record),
      generateContext,
      now: () => new Date('2026-11-08T00:00:00.000Z'),
    });
    const input = {
      organizationId: 'org-1',
      documentId: '00000000-0000-4000-8000-000000000001',
      documentName: 'handbook.pdf',
      chunks: [sampleChunk],
    };

    const first = await service.enrich(input);
    const second = await service.enrich(input);

    expect(first[0]).toBe(
      'Context: This passage describes the annual sick leave allowance.\n\nThe leave policy grants ten paid sick days each year.',
    );
    expect(second).toEqual(first);
    expect(generateContext).toHaveBeenCalledTimes(1);
  });

  it('rewrites a question into a concise search query', async () => {
    const generate = vi.fn(async () => 'annual paid sick leave allowance');
    const service = createQueryRewritingService(generate);

    await expect(service.rewrite('How many paid days can I take off when ill?')).resolves.toBe(
      'annual paid sick leave allowance',
    );
    expect(generate).toHaveBeenCalledOnce();
  });
});
