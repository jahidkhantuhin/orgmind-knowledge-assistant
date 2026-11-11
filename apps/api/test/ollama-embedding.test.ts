import { describe, expect, it, vi } from 'vitest';
import { createOllamaEmbeddingProvider } from '../src/modules/documents/embedding.service.js';

describe('Ollama embedding provider', () => {
  it('uses the Ollama embed endpoint with task-specific text prefixes', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify({ embeddings: [[3, 4]] }), { status: 200 }),
    );
    const provider = createOllamaEmbeddingProvider({
      baseURL: 'http://localhost:11434/',
      model: 'nomic-embed-text:v1.5',
      dimensions: 2,
      batchSize: 2,
      fetchImpl,
    });

    const [documentVector] = await provider.embed(['policy text'], 'document');
    const [queryVector] = await provider.embed(['leave days'], 'query');

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'nomic-embed-text:v1.5',
          input: ['search_document: policy text'],
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'nomic-embed-text:v1.5',
          input: ['search_query: leave days'],
        }),
      }),
    );
    expect(provider.profile).toBe('ollama:nomic-embed-text:v1.5:2');
    expect(Array.from(documentVector ?? [])[0]).toBeCloseTo(0.6);
    expect(Array.from(documentVector ?? [])[1]).toBeCloseTo(0.8);
    expect(Array.from(queryVector ?? [])[0]).toBeCloseTo(0.6);
    expect(Array.from(queryVector ?? [])[1]).toBeCloseTo(0.8);
  });

  it('rejects vectors that do not match the configured index dimensions', async () => {
    const provider = createOllamaEmbeddingProvider({
      baseURL: 'http://localhost:11434',
      model: 'nomic-embed-text:v1.5',
      dimensions: 2,
      batchSize: 1,
      fetchImpl: async () => new Response(JSON.stringify({ embeddings: [[1, 2, 3]] })),
    });

    await expect(provider.embed(['policy text'], 'document')).rejects.toThrow(
      'invalid 3-dimension vector',
    );
  });
});
