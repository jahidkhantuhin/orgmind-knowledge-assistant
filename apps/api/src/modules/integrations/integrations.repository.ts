import type { Collection, Document } from 'mongodb';
import type { GitHubIntegration } from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';

export type GitHubIntegrationRecord = Omit<
  GitHubIntegration,
  'id' | 'lastSyncedAt' | 'errorMessage' | 'createdAt' | 'updatedAt'
> & {
  _id: string;
  ownerUserId: string;
  accessToken: string;
  documentId?: string;
  contentHash?: string;
  lastSyncedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
};

type GitHubIntegrationRow = GitHubIntegrationRecord & Document;

function integrations(): Collection<GitHubIntegrationRow> {
  return getDatabase().collection<GitHubIntegrationRow>('integrations');
}

export const integrationsRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      integrations().createIndex(
        { organizationId: 1, createdAt: -1 },
        { name: 'integrations_organization_created' },
      ),
      integrations().createIndex(
        { organizationId: 1, provider: 1, owner: 1, repository: 1, branch: 1, path: 1 },
        { unique: true, name: 'integrations_github_source_unique' },
      ),
    ]);
  },

  async create(record: GitHubIntegrationRecord): Promise<void> {
    await integrations().insertOne(record);
  },

  async list(organizationId: string): Promise<GitHubIntegrationRecord[]> {
    return integrations().find({ organizationId }).sort({ createdAt: -1 }).toArray();
  },

  async find(id: string, organizationId: string): Promise<GitHubIntegrationRecord | null> {
    return integrations().findOne({ _id: id, organizationId });
  },

  async claimSync(id: string, organizationId: string): Promise<boolean> {
    const result = await integrations().updateOne(
      { _id: id, organizationId, status: { $ne: 'syncing' } },
      { $set: { status: 'syncing', updatedAt: new Date() }, $unset: { errorMessage: '' } },
    );
    return result.modifiedCount === 1;
  },

  async finishSync(
    id: string,
    organizationId: string,
    update: {
      status: 'ready' | 'error';
      lastSyncedAt?: Date;
      documentId?: string;
      contentHash?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    const { errorMessage, ...fields } = update;
    await integrations().updateOne(
      { _id: id, organizationId },
      {
        $set: {
          ...fields,
          ...(errorMessage ? { errorMessage: errorMessage.slice(0, 500) } : {}),
          updatedAt: new Date(),
        },
        ...(errorMessage ? {} : { $unset: { errorMessage: '' } }),
      },
    );
  },

  async updateAccessRoles(
    id: string,
    organizationId: string,
    accessRoles: Array<'member' | 'viewer'>,
  ): Promise<GitHubIntegrationRecord | null> {
    await integrations().updateOne(
      { _id: id, organizationId },
      { $set: { accessRoles, updatedAt: new Date() } },
    );
    return integrations().findOne({ _id: id, organizationId });
  },

  async delete(id: string, organizationId: string): Promise<GitHubIntegrationRecord | null> {
    return integrations().findOneAndDelete({ _id: id, organizationId });
  },
};
