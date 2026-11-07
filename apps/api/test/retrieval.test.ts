import { describe, expect, it, vi } from 'vitest';
import { createVectorRetrievalService } from '../src/modules/chat/retrieval.service.js';

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
      context: '',
    });
  });
});
