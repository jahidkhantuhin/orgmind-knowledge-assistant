import { randomUUID } from 'node:crypto';
import { Binary, MongoClient, type Collection, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import {
  chunksTextSearchDefinition,
  chunksVectorSearchDefinition,
  CHUNKS_TEXT_INDEX_NAME,
  CHUNKS_VECTOR_INDEX_NAME,
} from '../src/db/search-index-definitions.js';
import { buildHybridRetrievalPipeline } from '../src/modules/chat/hybrid-retrieval.pipeline.js';

type FixtureChunk = {
  _id: string;
  orgId: string;
  collectionId: string;
  acl: string[];
  documentId: string;
  chunkIndex: number;
  text: string;
  headingPath: string[];
  embedding: Binary;
};

async function waitForIndexes<T extends Document>(collection: Collection<T>) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const indexes = (await collection.listSearchIndexes().toArray()) as unknown as Array<{
      status?: string;
      queryable?: boolean;
    }>;
    if (
      indexes.length >= 2 &&
      indexes.every((index) => index.status === 'READY' && index.queryable === true)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Timed out waiting for local MongoDB Search indexes to become READY.');
}

describe('MongoDB hybrid retrieval integration', () => {
  it('fuses vector and keyword fixture results and returns rank details', async ({ skip }) => {
    const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 1_500 });
    const databaseName = `${env.TEST_MONGODB_DATABASE}_hybrid_${randomUUID().replaceAll('-', '')}`;
    try {
      try {
        await client.connect();
      } catch {
        skip();
        return;
      }

      const database = client.db(databaseName);
      // MongoDB Search index creation requires the namespace to exist first.
      await database.createCollection('chunks');
      const collection = database.collection<FixtureChunk>('chunks');

      const dimensions = env.EMBEDDING_DIMENSIONS;
      const vector = (index: number) => {
        const values = new Float32Array(dimensions);
        values[index] = 1;
        return Binary.fromFloat32Array(values);
      };
      const organizationId = `org-${randomUUID()}`;
      // Seed before index creation so READY means these fixtures are searchable too.
      await collection.insertMany([
        {
          _id: 'keyword-hit',
          orgId: organizationId,
          collectionId: 'default',
          acl: ['user:user-1'],
          documentId: randomUUID(),
          chunkIndex: 0,
          text: 'JavaScript object property access uses dot notation or bracket notation.',
          headingPath: ['JavaScript', 'Objects'],
          embedding: vector(1),
        },
        {
          _id: 'vector-hit',
          orgId: organizationId,
          collectionId: 'default',
          acl: ['group:team-1'],
          documentId: randomUUID(),
          chunkIndex: 1,
          text: 'A value can contain named fields that are read through a key.',
          headingPath: ['Data structures'],
          embedding: vector(0),
        },
        {
          _id: 'other-tenant',
          orgId: 'another-org',
          collectionId: 'default',
          acl: ['user:user-1'],
          documentId: randomUUID(),
          chunkIndex: 0,
          text: 'JavaScript object property access uses a key.',
          headingPath: [],
          embedding: vector(0),
        },
      ]);

      await Promise.all([
        collection.createSearchIndex({
          name: CHUNKS_VECTOR_INDEX_NAME,
          type: 'vectorSearch',
          definition: chunksVectorSearchDefinition,
        }),
        collection.createSearchIndex({
          name: CHUNKS_TEXT_INDEX_NAME,
          type: 'search',
          definition: chunksTextSearchDefinition,
        }),
      ]);
      await waitForIndexes(collection);

      const runSearch = (aclTokens: string[]) =>
        collection
          .aggregate<{
            _id: string;
            fusedScore: number;
            scoreDetails: { details?: Array<{ inputPipelineName?: string; rank?: number }> };
          }>(
            buildHybridRetrievalPipeline({
              query: 'JavaScript object property access',
              queryVector: Array.from({ length: dimensions }, (_value, index) =>
                index === 0 ? 1 : 0,
              ),
              organizationId,
              aclTokens,
              limit: 5,
              weights: { vector: 0.7, keyword: 0.3 },
            }),
          )
          .toArray();
      const results = await runSearch(['user:user-1', 'group:team-1', 'role:member']);

      expect(results.map((result) => result._id)).toContain('keyword-hit');
      expect(results.map((result) => result._id)).toContain('vector-hit');
      expect(results.map((result) => result._id)).not.toContain('other-tenant');
      expect(results.every((result) => result.fusedScore > 0)).toBe(true);
      expect(results.every((result) => (result.scoreDetails.details?.length ?? 0) > 0)).toBe(true);
      const userOnlyResults = await runSearch(['user:user-1']);
      expect(userOnlyResults.map((result) => result._id)).toEqual(['keyword-hit']);
      await expect(runSearch(['user:unrelated-user'])).resolves.toHaveLength(0);
    } finally {
      await client
        .db(databaseName)
        .dropDatabase()
        .catch(() => undefined);
      await client.close();
    }
  }, 120_000);
});
