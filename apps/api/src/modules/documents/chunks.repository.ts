import { Binary, type ClientSession, type Collection, type Document } from 'mongodb';
import {
  DocumentChunkPreviewSchema,
  DocumentChunkSchema,
  type DocumentChunk,
  type DocumentChunkPreview,
} from '@orgmind/shared';
import { env } from '../../config/env.js';
import { getDatabase } from '../../lib/connections.js';
import { CHUNKS_VECTOR_INDEX_NAME } from '../../db/search-index-definitions.js';
import {
  buildHybridRetrievalPipeline,
  type HybridRetrievalWeights,
} from '../chat/hybrid-retrieval.pipeline.js';
import type { RetrievalDebug } from '@orgmind/shared';

export type SimilarChunk = Pick<
  DocumentChunk,
  '_id' | 'documentId' | 'chunkIndex' | 'text' | 'headingPath'
> & {
  score: number;
  retrievalDebug?: RetrievalDebug;
};

type FusionScoreDetails = {
  value?: unknown;
  details?: Array<{ inputPipelineName?: unknown; rank?: unknown; value?: unknown }>;
};

function toRank(value: unknown): number | null {
  const rank = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function toFiniteScore(value: unknown): number | null {
  const score = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(score) ? score : null;
}

function retrievalDebug(details: FusionScoreDetails | undefined): RetrievalDebug | undefined {
  if (!details || !Array.isArray(details.details)) return undefined;
  const vector = details.details.find((entry) => entry.inputPipelineName === 'vector');
  const keyword = details.details.find((entry) => entry.inputPipelineName === 'keyword');
  const fusedScore = toFiniteScore(details.value);
  if (fusedScore === null) return undefined;
  return {
    vectorRank: toRank(vector?.rank),
    vectorScore: toFiniteScore(vector?.value),
    keywordRank: toRank(keyword?.rank),
    keywordScore: toFiniteScore(keyword?.value),
    fusedScore,
  };
}

type StoredChunk = Omit<DocumentChunk, 'embedding'> & { embedding: Binary } & Document;

function chunks(): Collection<StoredChunk> {
  return getDatabase().collection<StoredChunk>('chunks');
}

function toStoredChunk(value: DocumentChunk): StoredChunk {
  const chunk = DocumentChunkSchema.parse(value);
  if (chunk.embedding.length !== env.EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Chunk ${chunk._id} has ${chunk.embedding.length} dimensions; ${env.EMBEDDING_DIMENSIONS} are configured.`,
    );
  }
  return {
    ...chunk,
    embedding: Binary.fromFloat32Array(Float32Array.from(chunk.embedding)),
  } as StoredChunk;
}

function toPreview(value: unknown): DocumentChunkPreview {
  return DocumentChunkPreviewSchema.parse(value);
}

export const chunksRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      chunks().createIndex(
        { documentId: 1, chunkIndex: 1 },
        { unique: true, name: 'chunks_document_chunk_unique' },
      ),
      chunks().createIndex(
        { orgId: 1, collectionId: 1 },
        { name: 'chunks_organization_collection' },
      ),
    ]);
  },

  async replaceForDocument(
    documentId: string,
    records: DocumentChunk[],
    session?: ClientSession,
  ): Promise<void> {
    if (records.some((record) => record.documentId !== documentId)) {
      throw new Error('Cannot store chunks belonging to another document.');
    }
    await chunks().deleteMany({ documentId }, session ? { session } : {});
    if (records.length > 0) {
      await chunks().insertMany(records.map(toStoredChunk), {
        ...(session ? { session } : {}),
        ordered: true,
      });
    }
  },

  async deleteByDocument(documentId: string, session?: ClientSession): Promise<void> {
    await chunks().deleteMany({ documentId }, session ? { session } : {});
  },

  async countByDocument(documentId: string): Promise<number> {
    return chunks().countDocuments({ documentId });
  },

  async listPreviewsByDocument(documentId: string, limit = 20): Promise<DocumentChunkPreview[]> {
    const records = await chunks()
      .find({ documentId })
      .project({ embedding: 0 })
      .sort({ chunkIndex: 1 })
      .limit(limit)
      .toArray();
    return records.map(toPreview);
  },

  async listPreviewPageByDocument(
    documentId: string,
    afterChunkIndex: number,
    limit = 20,
  ): Promise<{ chunks: DocumentChunkPreview[]; nextCursor: number | null; hasMore: boolean }> {
    const records = await chunks()
      .find({ documentId, chunkIndex: { $gt: afterChunkIndex } })
      .project({ embedding: 0 })
      .sort({ chunkIndex: 1 })
      .limit(limit + 1)
      .toArray();
    const hasMore = records.length > limit;
    const page = records.slice(0, limit).map(toPreview);
    return {
      chunks: page,
      nextCursor: hasMore ? (page.at(-1)?.chunkIndex ?? null) : null,
      hasMore,
    };
  },

  async searchSimilar(
    queryVector: readonly number[],
    organizationId: string,
    limit: number,
  ): Promise<SimilarChunk[]> {
    const rows = await chunks()
      .aggregate<{
        _id: string;
        documentId: string;
        chunkIndex: number;
        text: string;
        headingPath: string[];
        score: number;
      }>([
        {
          $vectorSearch: {
            index: CHUNKS_VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector: [...queryVector],
            numCandidates: Math.max(100, limit * 20),
            limit,
            filter: {
              $and: [{ orgId: organizationId }, { collectionId: 'default' }],
            },
          },
        },
        {
          $project: {
            _id: 1,
            documentId: 1,
            chunkIndex: 1,
            text: 1,
            headingPath: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ])
      .toArray();
    return rows;
  },

  async searchHybrid(
    query: string,
    queryVector: readonly number[],
    organizationId: string,
    limit: number,
    weights: HybridRetrievalWeights,
  ): Promise<SimilarChunk[]> {
    const rows = await chunks()
      .aggregate<{
        _id: string;
        documentId: string;
        chunkIndex: number;
        text: string;
        headingPath: string[];
        fusedScore: number;
        scoreDetails?: FusionScoreDetails;
      }>(buildHybridRetrievalPipeline({ query, queryVector, organizationId, limit, weights }))
      .toArray();
    return rows.map((row) => {
      const debug = retrievalDebug(row.scoreDetails);
      return {
        _id: row._id,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        text: row.text,
        headingPath: row.headingPath,
        score: row.fusedScore,
        ...(debug ? { retrievalDebug: debug } : {}),
      };
    });
  },
};
