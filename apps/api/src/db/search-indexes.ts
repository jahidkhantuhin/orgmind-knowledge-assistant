import type { Collection, Document } from 'mongodb';
import { env } from '../config/env.js';
import { getDatabase } from '../lib/connections.js';
import { logger } from '../lib/logger.js';
import {
  CHUNKS_TEXT_INDEX_NAME,
  CHUNKS_VECTOR_INDEX_NAME,
  chunksTextSearchDefinition,
  chunksVectorSearchDefinition,
} from './search-index-definitions.js';

type SearchIndexStatus = {
  name?: string;
  type?: string;
  status?: string;
  queryable?: boolean;
  latestDefinition?: Document;
  definition?: Document;
  statusDetail?: unknown;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function definitionsMatch(actual: unknown, expected: unknown): boolean {
  return stable(actual) === stable(expected);
}

function isMappingsRequiredError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 2 &&
    error instanceof Error &&
    /"mappings" is required/i.test(error.message)
  );
}

async function waitForSearchIndexRemoval(
  collection: Collection<Document>,
  name: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const indexes = await collection.listSearchIndexes(name).toArray();
    if (indexes.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for MongoDB Search index "${name}" to be removed.`);
}

export async function upsertSearchIndex(
  collection: Collection<Document>,
  name: string,
  type: 'search' | 'vectorSearch',
  definition: Document,
): Promise<void> {
  const existing = (await collection.listSearchIndexes(name).toArray()) as SearchIndexStatus[];
  const index = existing[0];
  if (!index) {
    await collection.createSearchIndex({ name, type, definition });
    return;
  }
  const currentDefinition = index.latestDefinition ?? index.definition;
  if (index.type !== type || !definitionsMatch(currentDefinition, definition)) {
    try {
      await collection.updateSearchIndex(name, definition);
    } catch (error) {
      if (type !== 'vectorSearch' || !isMappingsRequiredError(error)) throw error;
      logger.warn(
        { indexName: name },
        'MongoDB rejected the vector index update as a Search mapping; rebuilding the vector index.',
      );
      await collection.dropSearchIndex(name);
      await waitForSearchIndexRemoval(collection, name, env.SEARCH_INDEX_WAIT_TIMEOUT_MS);
      await collection.createSearchIndex({ name, type, definition });
    }
  }
}

async function waitForIndex(
  collection: Collection<Document>,
  name: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const indexes = (await collection.listSearchIndexes(name).toArray()) as SearchIndexStatus[];
    const index = indexes[0];
    if (index?.status === 'READY' && index.queryable === true) return;
    if (index?.status === 'FAILED') {
      throw new Error(
        `MongoDB Search index "${name}" failed to build: ${JSON.stringify(index.statusDetail)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for MongoDB Search index "${name}" to become READY.`);
}

export async function ensureChunkSearchIndexes(): Promise<void> {
  const collection = getDatabase().collection<Document>('chunks');
  await upsertSearchIndex(
    collection,
    CHUNKS_VECTOR_INDEX_NAME,
    'vectorSearch',
    chunksVectorSearchDefinition,
  );
  await upsertSearchIndex(collection, CHUNKS_TEXT_INDEX_NAME, 'search', chunksTextSearchDefinition);
  await Promise.all([
    waitForIndex(collection, CHUNKS_VECTOR_INDEX_NAME, env.SEARCH_INDEX_WAIT_TIMEOUT_MS),
    waitForIndex(collection, CHUNKS_TEXT_INDEX_NAME, env.SEARCH_INDEX_WAIT_TIMEOUT_MS),
  ]);
}

export async function waitForChunkSearchIndexes(): Promise<void> {
  const collection = getDatabase().collection<Document>('chunks');
  await Promise.all([
    waitForIndex(collection, CHUNKS_VECTOR_INDEX_NAME, env.SEARCH_INDEX_WAIT_TIMEOUT_MS),
    waitForIndex(collection, CHUNKS_TEXT_INDEX_NAME, env.SEARCH_INDEX_WAIT_TIMEOUT_MS),
  ]);
}
