import { describe, expect, it } from 'vitest';
import {
  CHUNKS_TEXT_INDEX_NAME,
  CHUNKS_VECTOR_INDEX_NAME,
} from '../src/db/search-index-definitions.js';
import { buildHybridRetrievalPipeline } from '../src/modules/chat/hybrid-retrieval.pipeline.js';

describe('hybrid retrieval pipeline builder', () => {
  it('builds tenant-filtered vector and keyword pipelines with configured fusion weights', () => {
    const pipeline = buildHybridRetrievalPipeline({
      query: 'invoice retention',
      queryVector: [0.25, 0.75],
      organizationId: 'org-1',
      limit: 5,
      weights: { vector: 0.7, keyword: 0.3 },
    });

    const fusion = pipeline[0]?.$rankFusion as {
      input: { pipelines: Record<string, Array<Record<string, unknown>>> };
      combination: { weights: Record<string, number> };
      scoreDetails: boolean;
    };
    expect((fusion.input.pipelines.vector ?? [])[0]?.$vectorSearch).toMatchObject({
      index: CHUNKS_VECTOR_INDEX_NAME,
      path: 'embedding',
      queryVector: [0.25, 0.75],
      filter: { $and: [{ orgId: 'org-1' }, { collectionId: 'default' }] },
    });
    expect((fusion.input.pipelines.keyword ?? [])[0]?.$search).toMatchObject({
      index: CHUNKS_TEXT_INDEX_NAME,
      compound: {
        must: [{ text: { query: 'invoice retention', path: 'text' } }],
        filter: [
          { equals: { path: 'orgId', value: 'org-1' } },
          { equals: { path: 'collectionId', value: 'default' } },
        ],
      },
    });
    expect(fusion.combination.weights).toEqual({ vector: 0.7, keyword: 0.3 });
    expect(fusion.scoreDetails).toBe(true);
    expect(pipeline[1]).toEqual({ $limit: 5 });
    expect(pipeline[2]?.$project).toMatchObject({
      fusedScore: { $meta: 'score' },
      scoreDetails: { $meta: 'scoreDetails' },
    });
  });
});
