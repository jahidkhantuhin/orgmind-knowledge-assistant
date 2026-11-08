import type { ClientSession, Collection, Document } from 'mongodb';
import { getDatabase } from '../../lib/connections.js';

type CollectionAccess = {
  _id: string;
  organizationId: string;
  collectionId: string;
  acl: string[];
  createdAt: Date;
  updatedAt: Date;
} & Document;

function collectionAccess(): Collection<CollectionAccess> {
  return getDatabase().collection<CollectionAccess>('document_collection_access');
}

function idFor(organizationId: string, collectionId: string) {
  return `${organizationId}:${collectionId}`;
}

export const documentCollectionsRepository = {
  async ensureIndexes(): Promise<void> {
    await collectionAccess().createIndex(
      { organizationId: 1, collectionId: 1 },
      { unique: true, name: 'document_collection_access_unique' },
    );
  },

  async getOrCreate(
    organizationId: string,
    collectionId: string,
    defaultAcl: string[],
  ): Promise<string[]> {
    const now = new Date();
    await collectionAccess().updateOne(
      { _id: idFor(organizationId, collectionId) },
      {
        $setOnInsert: {
          organizationId,
          collectionId,
          acl: defaultAcl,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    const row = await collectionAccess().findOne({ _id: idFor(organizationId, collectionId) });
    if (!row) throw new Error('Folder access settings could not be initialized.');
    return row.acl;
  },

  async get(organizationId: string, collectionId: string): Promise<string[] | null> {
    const row = await collectionAccess().findOne({
      _id: idFor(organizationId, collectionId),
    });
    return row?.acl ?? null;
  },

  async set(
    organizationId: string,
    collectionId: string,
    acl: string[],
    session?: ClientSession,
  ): Promise<void> {
    const now = new Date();
    await collectionAccess().updateOne(
      { _id: idFor(organizationId, collectionId) },
      {
        $set: { acl, updatedAt: now },
        $setOnInsert: { organizationId, collectionId, createdAt: now },
      },
      { upsert: true, ...(session ? { session } : {}) },
    );
  },

  async backfillFromDocuments(): Promise<void> {
    const database = getDatabase();
    const policies = await database
      .collection('documents')
      .aggregate<{ _id: { organizationId: string; collectionId: string }; acl: string[] }>([
        {
          $group: {
            _id: { organizationId: '$organizationId', collectionId: '$collectionId' },
            acl: {
              $first: {
                $setDifference: [{ $ifNull: ['$acl', []] }, [{ $concat: ['user:', '$ownerId'] }]],
              },
            },
          },
        },
      ])
      .toArray();
    for (const policy of policies) {
      const now = new Date();
      await collectionAccess().updateOne(
        { _id: idFor(policy._id.organizationId, policy._id.collectionId) },
        {
          $setOnInsert: {
            organizationId: policy._id.organizationId,
            collectionId: policy._id.collectionId,
            acl: policy.acl ?? ['role:admin', 'role:member', 'role:viewer'],
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
  },
};
