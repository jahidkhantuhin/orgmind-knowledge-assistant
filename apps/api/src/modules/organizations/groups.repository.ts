import { randomUUID } from 'node:crypto';
import type { Collection, Document } from 'mongodb';
import { getDatabase, mongoClient } from '../../lib/connections.js';

export type TeamGroupRecord = {
  _id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
} & Document;

type MembershipGroupRecord = {
  organizationId: string;
  groupIds: string[];
  updatedAt?: Date;
} & Document;

function groups(): Collection<TeamGroupRecord> {
  return getDatabase().collection<TeamGroupRecord>('team_groups');
}

export const groupsRepository = {
  async ensureIndexes(): Promise<void> {
    await groups().createIndex(
      { organizationId: 1, name: 1 },
      { unique: true, name: 'team_groups_organization_name_unique' },
    );
  },
  async list(organizationId: string): Promise<TeamGroupRecord[]> {
    return groups().find({ organizationId }).sort({ name: 1 }).toArray();
  },
  async create(organizationId: string, name: string): Promise<TeamGroupRecord> {
    const group: TeamGroupRecord = {
      _id: randomUUID(),
      organizationId,
      name,
      createdAt: new Date(),
    };
    await groups().insertOne(group);
    return group;
  },
  async findIds(organizationId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    return (
      await groups()
        .find({ organizationId, _id: { $in: ids } })
        .project({ _id: 1 })
        .toArray()
    ).map((group) => group._id);
  },
  async delete(organizationId: string, groupId: string): Promise<boolean> {
    const session = mongoClient.startSession();
    let deleted = false;
    try {
      await session.withTransaction(async () => {
        const existing = await groups().findOne({ organizationId, _id: groupId }, { session });
        if (!existing) return;
        const memberships = getDatabase().collection<MembershipGroupRecord>('memberships');
        const assignedMembers = await memberships
          .find({ organizationId, groupIds: groupId }, { session })
          .toArray();
        for (const member of assignedMembers) {
          await memberships.updateOne(
            { _id: member._id },
            {
              $set: {
                groupIds: member.groupIds.filter((id) => id !== groupId),
                updatedAt: new Date(),
              },
            },
            { session },
          );
        }
        deleted =
          (await groups().deleteOne({ organizationId, _id: groupId }, { session })).deletedCount ===
          1;
      });
      return deleted;
    } finally {
      await session.endSession();
    }
  },
  async rename(
    organizationId: string,
    groupId: string,
    name: string,
  ): Promise<TeamGroupRecord | null> {
    const updated = await groups().findOneAndUpdate(
      { organizationId, _id: groupId },
      { $set: { name } },
      { returnDocument: 'after' },
    );
    return updated ?? null;
  },
};
