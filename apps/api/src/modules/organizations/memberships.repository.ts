import { randomUUID } from 'node:crypto';
import { type ClientSession, type Collection, type Document } from 'mongodb';
import {
  MembershipDocumentSchema,
  type MembershipDocument,
  type MembershipRole,
} from '@orgmind/shared';
import { getDatabase, mongoClient } from '../../lib/connections.js';

function memberships(): Collection<Document> {
  return getDatabase().collection('memberships');
}

function parseDocument(value: unknown): MembershipDocument {
  return MembershipDocumentSchema.parse(value);
}

export const membershipsRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      memberships().createIndex(
        { organizationId: 1, userId: 1 },
        { unique: true, name: 'memberships_organization_user_unique' },
      ),
      memberships().createIndex({ userId: 1 }, { name: 'memberships_user' }),
    ]);
  },

  async ensureMembership(
    organizationId: string,
    userId: string,
    role: MembershipRole,
    session?: ClientSession,
  ): Promise<MembershipDocument> {
    const now = new Date();
    const options = session ? { upsert: true, session } : { upsert: true };
    await memberships().updateOne(
      { organizationId, userId },
      {
        $setOnInsert: {
          _id: randomUUID(),
          organizationId,
          userId,
          role,
          groupIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      options,
    );
    const result = await memberships().findOne(
      { organizationId, userId },
      session ? { session } : {},
    );
    if (!result) throw new Error('Membership was not available after the upsert.');
    return parseDocument(result);
  },

  async findForUser(userId: string): Promise<MembershipDocument[]> {
    const rows = await memberships().find({ userId }).sort({ createdAt: 1 }).toArray();
    return rows.map(parseDocument);
  },

  async findForOrganization(organizationId: string): Promise<MembershipDocument[]> {
    const rows = await memberships().find({ organizationId }).sort({ createdAt: 1 }).toArray();
    return rows.map(parseDocument);
  },

  async findUserIdsInOrganization(organizationId: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await memberships()
      .find({ organizationId, userId: { $in: userIds } })
      .project({ userId: 1 })
      .toArray();
    return rows.map((row) => String(row.userId));
  },

  async findForUserInOrganization(
    userId: string,
    organizationId: string,
  ): Promise<MembershipDocument | null> {
    const row = await memberships().findOne({ userId, organizationId });
    return row ? parseDocument(row) : null;
  },

  async setGroupIdsForUserInOrganization(
    userId: string,
    organizationId: string,
    groupIds: string[],
  ): Promise<boolean> {
    const result = await memberships().updateOne(
      { userId, organizationId },
      { $set: { groupIds, updatedAt: new Date() } },
    );
    return result.matchedCount === 1;
  },

  async updateRoleForUserInOrganization(
    organizationId: string,
    userId: string,
    role: MembershipRole,
  ): Promise<'updated' | 'last_admin' | 'not_found'> {
    const session = mongoClient.startSession();
    let result: 'updated' | 'last_admin' | 'not_found' = 'not_found';
    try {
      await session.withTransaction(async () => {
        const target = await memberships().findOne({ organizationId, userId }, { session });
        if (!target) {
          result = 'not_found';
          return;
        }
        if (target.role === 'admin' && role !== 'admin') {
          const adminCount = await memberships().countDocuments(
            { organizationId, role: 'admin' },
            { session },
          );
          if (adminCount <= 1) {
            result = 'last_admin';
            return;
          }
        }
        await memberships().updateOne(
          { organizationId, userId },
          { $set: { role, updatedAt: new Date() } },
          { session },
        );
        result = 'updated';
      });
      return result;
    } finally {
      await session.endSession();
    }
  },

  async removeFromOrganization(
    organizationId: string,
    userId: string,
  ): Promise<'removed' | 'last_admin' | 'not_found'> {
    const session = mongoClient.startSession();
    let result: 'removed' | 'last_admin' | 'not_found' = 'not_found';
    try {
      await session.withTransaction(async () => {
        const target = await memberships().findOne({ organizationId, userId }, { session });
        if (!target) {
          result = 'not_found';
          return;
        }
        if (target.role === 'admin') {
          const adminCount = await memberships().countDocuments(
            { organizationId, role: 'admin' },
            { session },
          );
          if (adminCount <= 1) {
            result = 'last_admin';
            return;
          }
        }
        await memberships().deleteOne({ organizationId, userId }, { session });
        result = 'removed';
      });
      return result;
    } finally {
      await session.endSession();
    }
  },
};
