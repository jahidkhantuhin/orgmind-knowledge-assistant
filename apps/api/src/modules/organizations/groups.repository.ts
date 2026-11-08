import { randomUUID } from 'node:crypto';
import type { Collection, Document } from 'mongodb';
import { getDatabase } from '../../lib/connections.js';

export type TeamGroupRecord = {
  _id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
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
    return (await groups().deleteOne({ organizationId, _id: groupId })).deletedCount === 1;
  },
};
