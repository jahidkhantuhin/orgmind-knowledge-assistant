import type { ClientSession, Collection, Document } from 'mongodb';
import { ContextualEnrichmentCacheSchema, type ContextualEnrichmentCache } from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';

type CacheRow = ContextualEnrichmentCache & Document;

function cache(): Collection<CacheRow> {
  return getDatabase().collection<CacheRow>('context_enrichment_cache');
}

export const contextualEnrichmentRepository = {
  async ensureIndexes(): Promise<void> {
    await cache().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'context_cache_expiry' },
    );
    await cache().createIndex(
      { organizationId: 1, documentId: 1, chunkIndex: 1 },
      { name: 'context_cache_document_chunk' },
    );
  },

  async findMany(ids: string[]): Promise<ContextualEnrichmentCache[]> {
    if (ids.length === 0) return [];
    const records = await cache()
      .find({ _id: { $in: ids }, expiresAt: { $gt: new Date() } })
      .toArray();
    return records.map((record) => ContextualEnrichmentCacheSchema.parse(record));
  },

  async save(record: ContextualEnrichmentCache): Promise<void> {
    const validated = ContextualEnrichmentCacheSchema.parse(record) as CacheRow;
    await cache().updateOne({ _id: validated._id }, { $setOnInsert: validated }, { upsert: true });
  },

  async deleteByDocument(
    documentId: string,
    organizationId: string,
    session?: ClientSession,
  ): Promise<void> {
    await cache().deleteMany({ documentId, organizationId }, session ? { session } : {});
  },
};
