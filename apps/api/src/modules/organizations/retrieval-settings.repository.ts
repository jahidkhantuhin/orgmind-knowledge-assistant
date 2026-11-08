import type { Collection, Document } from 'mongodb';
import { RetrievalSettingsRecordSchema, type RetrievalSettingsRecord } from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';
import { env } from '../../config/env.js';

type SettingsRow = RetrievalSettingsRecord & Document;

function settings(): Collection<SettingsRow> {
  return getDatabase().collection<SettingsRow>('retrieval_settings');
}

export const retrievalSettingsRepository = {
  async ensureIndexes(): Promise<void> {
    await settings().createIndex({ updatedAt: -1 }, { name: 'retrieval_settings_updated' });
  },

  async get(organizationId: string): Promise<RetrievalSettingsRecord> {
    const record = await settings().findOne({ _id: organizationId });
    if (record) return RetrievalSettingsRecordSchema.parse(record);
    return RetrievalSettingsRecordSchema.parse({
      _id: organizationId,
      rerankingEnabled: false,
      queryRewriteEnabled: env.CHAT_QUERY_REWRITE_DEFAULT_ENABLED,
      updatedAt: new Date(0),
    });
  },

  async update(
    organizationId: string,
    input: Pick<RetrievalSettingsRecord, 'rerankingEnabled' | 'queryRewriteEnabled'>,
  ): Promise<RetrievalSettingsRecord> {
    const record = RetrievalSettingsRecordSchema.parse({
      _id: organizationId,
      ...input,
      updatedAt: new Date(),
    }) as SettingsRow;
    const saved = await settings().findOneAndUpdate(
      { _id: organizationId },
      { $set: { ...input, updatedAt: record.updatedAt }, $setOnInsert: { _id: organizationId } },
      { upsert: true, returnDocument: 'after' },
    );
    return RetrievalSettingsRecordSchema.parse(saved);
  },
};
