import type { Document } from 'mongodb';
import {
  CHUNKS_TEXT_INDEX_NAME,
  CHUNKS_VECTOR_INDEX_NAME,
} from '../../db/search-index-definitions.js';

export type HybridRetrievalWeights = { vector: number; keyword: number };

export function buildHybridRetrievalPipeline(input: {
  query: string;
  queryVector: readonly number[];
  organizationId: string;
  aclTokens: string[];
  limit: number;
  weights: HybridRetrievalWeights;
}): Document[] {
  const candidateLimit = Math.max(100, input.limit * 20);
  return [
    {
      $rankFusion: {
        input: {
          pipelines: {
            vector: [
              {
                $vectorSearch: {
                  index: CHUNKS_VECTOR_INDEX_NAME,
                  path: 'embedding',
                  queryVector: [...input.queryVector],
                  numCandidates: candidateLimit,
                  limit: candidateLimit,
                  filter: {
                    $and: [
                      { orgId: input.organizationId },
                      { $or: input.aclTokens.map((token) => ({ acl: token })) },
                    ],
                  },
                },
              },
            ],
            keyword: [
              {
                $search: {
                  index: CHUNKS_TEXT_INDEX_NAME,
                  compound: {
                    must: [{ text: { query: input.query, path: 'text' } }],
                    filter: [
                      { equals: { path: 'orgId', value: input.organizationId } },
                      {
                        compound: {
                          should: input.aclTokens.map((token) => ({
                            equals: { path: 'acl', value: token },
                          })),
                          minimumShouldMatch: 1,
                        },
                      },
                    ],
                  },
                },
              },
              { $limit: candidateLimit },
            ],
          },
        },
        combination: { weights: input.weights },
        scoreDetails: true,
      },
    },
    { $limit: input.limit },
    {
      $project: {
        _id: 1,
        documentId: 1,
        chunkIndex: 1,
        text: 1,
        headingPath: 1,
        fusedScore: { $meta: 'score' },
        scoreDetails: { $meta: 'scoreDetails' },
      },
    },
  ];
}
