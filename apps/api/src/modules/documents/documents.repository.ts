import { type ClientSession, type Collection, type Document } from 'mongodb';
import { DocumentRecordSchema, type DocumentRecord, type DocumentStatus } from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';

type DocumentRow = DocumentRecord & Document;

function documents(): Collection<DocumentRow> {
  return getDatabase().collection<DocumentRow>('documents');
}

function parseDocument(value: unknown): DocumentRecord {
  return DocumentRecordSchema.parse(value);
}

export const documentsRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      documents().createIndex(
        { organizationId: 1, createdAt: -1 },
        { name: 'documents_organization_created' },
      ),
      documents().createIndex({ ownerId: 1 }, { name: 'documents_owner' }),
      documents().createIndex(
        { storageKey: 1 },
        { unique: true, name: 'documents_storage_key_unique' },
      ),
    ]);
  },

  async create(record: DocumentRecord): Promise<DocumentRecord> {
    await documents().insertOne(record);
    return record;
  },

  async findById(id: string): Promise<DocumentRecord | null> {
    const row = await documents().findOne({ _id: id });
    return row ? parseDocument(row) : null;
  },

  async findByIdInOrganization(id: string, organizationId: string): Promise<DocumentRecord | null> {
    const row = await documents().findOne({ _id: id, organizationId });
    return row ? parseDocument(row) : null;
  },

  async findByIdsInOrganization(ids: string[], organizationId: string): Promise<DocumentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await documents()
      .find({ _id: { $in: ids }, organizationId })
      .toArray();
    return rows.map(parseDocument);
  },

  async listByOrganization(organizationId: string): Promise<DocumentRecord[]> {
    const rows = await documents().find({ organizationId }).sort({ createdAt: -1 }).toArray();
    return rows.map(parseDocument);
  },

  async setStatus(id: string, status: DocumentStatus): Promise<void> {
    await documents().updateOne({ _id: id }, { $set: { status, updatedAt: new Date() } });
  },

  async markParsing(id: string): Promise<void> {
    await documents().updateOne(
      { _id: id },
      {
        $set: { status: 'parsing', progress: 1, updatedAt: new Date() },
        $unset: { failureReason: '' },
      },
    );
  },

  async markChunking(id: string): Promise<void> {
    await documents().updateOne(
      { _id: id },
      {
        $set: { status: 'chunking', progress: 5, updatedAt: new Date() },
        $unset: { failureReason: '' },
      },
    );
  },

  async markEmbedding(id: string): Promise<void> {
    await documents().updateOne(
      { _id: id },
      {
        $set: { status: 'embedding', progress: 10, updatedAt: new Date() },
        $unset: { failureReason: '' },
      },
    );
  },

  async updateProgress(id: string, progress: number): Promise<void> {
    await documents().updateOne(
      { _id: id, status: 'embedding' },
      {
        $set: { progress: Math.min(95, Math.max(10, Math.floor(progress))), updatedAt: new Date() },
      },
    );
  },

  async markParsed(
    id: string,
    extractedText: string,
    chunkCount: number,
    session?: ClientSession,
  ): Promise<void> {
    const now = new Date();
    await documents().updateOne(
      { _id: id },
      {
        $set: {
          status: 'parsed',
          progress: 100,
          extractedText,
          chunkCount,
          parsedAt: now,
          chunkedAt: now,
          embeddedAt: now,
          updatedAt: now,
        },
        $unset: { failureReason: '' },
      },
      session ? { session } : {},
    );
  },

  async queueForReingestion(id: string, organizationId: string): Promise<boolean> {
    const result = await documents().updateOne(
      { _id: id, organizationId, status: { $in: ['parsed', 'failed'] } },
      {
        $set: { status: 'uploaded', progress: 0, updatedAt: new Date() },
        $unset: { failureReason: '' },
      },
    );
    return result.modifiedCount === 1;
  },

  async markFailed(id: string, failureReason: string): Promise<void> {
    await documents().updateOne(
      { _id: id },
      {
        $set: {
          status: 'failed',
          failureReason: failureReason.slice(0, 500),
          updatedAt: new Date(),
        },
      },
    );
  },

  async deleteByIdInOrganization(
    id: string,
    organizationId: string,
    session?: ClientSession,
  ): Promise<DocumentRecord | null> {
    const row = await documents().findOneAndDelete(
      { _id: id, organizationId },
      session ? { session } : {},
    );
    return row ? parseDocument(row) : null;
  },
};
