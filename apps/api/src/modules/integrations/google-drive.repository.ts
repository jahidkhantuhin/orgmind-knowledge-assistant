import type { Collection, Document } from 'mongodb';
import type { GoogleDriveIntegration } from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';

export type GoogleDriveIntegrationRecord = Omit<
  GoogleDriveIntegration,
  'id' | 'lastSyncedAt' | 'errorMessage' | 'createdAt' | 'updatedAt'
> & {
  _id: string;
  ownerUserId: string;
  refreshToken: string;
  documentId?: string;
  contentHash?: string;
  lastSyncedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
};

type OAuthStateRecord = {
  _id: string;
  stateHash: string;
  organizationId: string;
  ownerUserId: string;
  fileId: string;
  accessRoles: Array<'member' | 'viewer'>;
  createdAt: Date;
  expiresAt: Date;
};

type DriveIntegrationRow = GoogleDriveIntegrationRecord & Document;
type OAuthStateRow = OAuthStateRecord & Document;

function integrations(): Collection<DriveIntegrationRow> {
  return getDatabase().collection<DriveIntegrationRow>('googleDriveIntegrations');
}

function oauthStates(): Collection<OAuthStateRow> {
  return getDatabase().collection<OAuthStateRow>('googleDriveOAuthStates');
}

export const googleDriveRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      integrations().createIndex({ organizationId: 1, createdAt: -1 }),
      integrations().createIndex(
        { organizationId: 1, fileId: 1 },
        { unique: true, name: 'google_drive_workspace_file_unique' },
      ),
      oauthStates().createIndex({ stateHash: 1 }, { unique: true }),
      oauthStates().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  },

  async create(record: GoogleDriveIntegrationRecord): Promise<void> {
    await integrations().insertOne(record);
  },

  async list(organizationId: string): Promise<GoogleDriveIntegrationRecord[]> {
    return integrations().find({ organizationId }).sort({ createdAt: -1 }).toArray();
  },

  async find(id: string, organizationId: string): Promise<GoogleDriveIntegrationRecord | null> {
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
  ): Promise<GoogleDriveIntegrationRecord | null> {
    await integrations().updateOne(
      { _id: id, organizationId },
      { $set: { accessRoles, updatedAt: new Date() } },
    );
    return integrations().findOne({ _id: id, organizationId });
  },

  async delete(id: string, organizationId: string): Promise<GoogleDriveIntegrationRecord | null> {
    return integrations().findOneAndDelete({ _id: id, organizationId });
  },

  async createOAuthState(record: OAuthStateRecord): Promise<void> {
    await oauthStates().insertOne(record);
  },

  async consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null> {
    return oauthStates().findOneAndDelete({ stateHash, expiresAt: { $gt: new Date() } });
  },
};
