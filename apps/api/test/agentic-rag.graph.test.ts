import { describe, expect, it, vi } from 'vitest';
import {
  createAgenticRagGraph,
  type AgenticDependencies,
} from '../src/modules/chat/agentic-rag.graph.js';
import type { RetrievalResult } from '../src/modules/chat/retrieval.service.js';

const passage: RetrievalResult = {
  citations: [
    {
      chunkId: 'chunk-1',
      documentId: 'document-1',
      documentName: 'Handbook.pdf',
      chunkIndex: 0,
      headingPath: ['Leave'],
      passage: 'Employees receive ten sick days.',
      score: 0.9,
    },
  ],
  debug: [],
  context: '[S1] Handbook.pdf\nEmployees receive ten sick days.',
  latencyMs: { embedding: 10, search: 20, rerank: 0, total: 30 },
};

function deps(overrides: Partial<AgenticDependencies> = {}): AgenticDependencies {
  return {
    retrieve: vi.fn(async () => passage),
    route: vi.fn(async () => ({ needsRetrieval: true, queries: ['sick leave'] })),
    grade: vi.fn(async () => ({ relevant: true, expandedQueries: [] })),
    answer: vi.fn(async () => ({ text: 'Ten days [S1].' })),
    verify: vi.fn(async () => ({ grounded: true })),
    maxIterations: 2,
    maxCostUsd: 0.05,
    ...overrides,
  };
}

describe('agentic RAG graph', () => {
  it('routes a conversational question around retrieval', async () => {
    const route = vi.fn(async () => ({ needsRetrieval: false, queries: [] }));
    const retrieve = vi.fn(async () => passage);
    const graph = createAgenticRagGraph(deps({ route, retrieve }));
    const result = await graph.run({
      question: 'Hello',
      organizationId: 'org-1',
      aclTokens: ['org:admin'],
    });
    expect(result.answer).toBe('Ten days [S1].');
    expect(retrieve).not.toHaveBeenCalled();
    expect(result.citations).toEqual([]);
  });

  it('retries once on weak evidence and returns only grounded citations', async () => {
    const steps: string[] = [];
    const retrieve = vi.fn(async () => passage);
    const grade = vi
      .fn()
      .mockResolvedValueOnce({ relevant: false, expandedQueries: ['doctor note policy'] })
      .mockResolvedValueOnce({ relevant: true, expandedQueries: [] });
    const graph = createAgenticRagGraph(
      deps({
        retrieve,
        grade,
        emit: (step) => steps.push(`${step.id}:${step.status}`),
      }),
    );
    const result = await graph.run({
      question: 'When is sick leave available?',
      organizationId: 'org-1',
      aclTokens: ['org:admin'],
    });
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(grade).toHaveBeenCalledTimes(2);
    expect(result.answer).toBe('Ten days [S1].');
    expect(result.citations).toHaveLength(1);
    expect(steps).toContain('expand:retrying');
    expect(steps).toContain('verify:completed');
  });

  it('returns no answer or citations when verification rejects the draft', async () => {
    const graph = createAgenticRagGraph(deps({ verify: vi.fn(async () => ({ grounded: false })) }));
    const result = await graph.run({
      question: 'Question',
      organizationId: 'org-1',
      aclTokens: ['org:admin'],
    });
    expect(result.answer).toBe('');
    expect(result.citations).toEqual([]);
  });

  it('stops scheduling model stages when the accumulated cost reaches the cap', async () => {
    const answer = vi.fn(async () => ({ text: 'should not run' }));
    const graph = createAgenticRagGraph(
      deps({
        maxCostUsd: 0.001,
        route: vi.fn(async () => ({
          needsRetrieval: true,
          queries: ['query'],
          estimatedCostUsd: 0.01,
        })),
        answer,
      }),
    );
    const result = await graph.run({
      question: 'Question',
      organizationId: 'org-1',
      aclTokens: ['org:admin'],
    });
    expect(answer).not.toHaveBeenCalled();
    expect(result.answer).toBe('');
    expect(result.citations).toEqual([]);
  });
});
