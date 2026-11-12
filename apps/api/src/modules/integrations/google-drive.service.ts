import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { GoogleDriveIntegrationSchema, type GoogleDriveIntegration } from '@orgmind/shared';
import { env } from '../../config/env.js';
import { documentsService } from '../documents/documents.service.js';
import { documentCollectionsRepository } from '../documents/document-collections.repository.js';
import { aclTokensForGrant } from '../documents/document-acl.js';
import { encryptIntegrationToken, decryptIntegrationToken } from './integration-secrets.js';
import {
  googleDriveRepository,
  type GoogleDriveIntegrationRecord,
} from './google-drive.repository.js';
import {
  exchangeGoogleDriveAuthorization,
  fetchGoogleDriveFile,
  googleDriveAuthorizationUrl,
} from './google-drive.client.js';

const STATE_LIFETIME_MS = 10 * 60 * 1000;

function publicIntegration(record: GoogleDriveIntegrationRecord): GoogleDriveIntegration {
  return GoogleDriveIntegrationSchema.parse({
    id: record._id,
    organizationId: record.organizationId,
    provider: record.provider,
    fileId: record.fileId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    accessRoles: record.accessRoles,
    status: record.status,
    ...(record.documentId ? { documentId: record.documentId } : {}),
    ...(record.lastSyncedAt ? { lastSyncedAt: record.lastSyncedAt.toISOString() } : {}),
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function collectionIdFor(id: string) {
  return `google-drive-${id}`;
}

function accessAcl(accessRoles: Array<'member' | 'viewer'>) {
  return aclTokensForGrant({ roles: accessRoles, userIds: [], groupIds: [] });
}

function fileIdFromUrl(fileUrl: string): string {
  const trimmed = fileUrl.trim();
  if (/^[\w-]{10,200}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a Google Drive file URL or file ID.');
  }
  if (
    url.protocol !== 'https:' ||
    !['drive.google.com', 'docs.google.com'].includes(url.hostname)
  ) {
    throw new Error('Use a file URL from drive.google.com or docs.google.com.');
  }
  const pathId = url.pathname.match(/\/d\/([\w-]{10,200})(?:\/|$)/)?.[1];
  const queryId = url.searchParams.get('id');
  const id = pathId ?? queryId;
  if (!id || !/^[\w-]{10,200}$/.test(id)) {
    throw new Error('Could not read a Google Drive file ID from that URL.');
  }
  return id;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Google Drive sync failed.';
  return message.replace(/\bya29\.[\w.-]+\b/g, '[redacted]').slice(0, 500);
}

export class GoogleDriveIntegrationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'GOOGLE_DRIVE_INTEGRATION_NOT_FOUND';
  constructor() {
    super('Google Drive source not found.');
    this.name = 'GoogleDriveIntegrationNotFoundError';
  }
}

export class GoogleDriveIntegrationBusyError extends Error {
  readonly statusCode = 409;
  readonly code = 'GOOGLE_DRIVE_INTEGRATION_SYNCING';
  constructor() {
    super('This Google Drive file is already syncing.');
    this.name = 'GoogleDriveIntegrationBusyError';
  }
}

export const googleDriveService = {
  async list(organizationId: string): Promise<GoogleDriveIntegration[]> {
    return (await googleDriveRepository.list(organizationId)).map(publicIntegration);
  },

  async startAuthorization(
    organizationId: string,
    ownerUserId: string,
    fileUrl: string,
    accessRoles: Array<'member' | 'viewer'>,
  ): Promise<string> {
    const fileId = fileIdFromUrl(fileUrl);
    const state = randomBytes(32).toString('base64url');
    const now = new Date();
    await googleDriveRepository.createOAuthState({
      _id: randomUUID(),
      stateHash: createHash('sha256').update(state).digest('hex'),
      organizationId,
      ownerUserId,
      fileId,
      accessRoles,
      createdAt: now,
      expiresAt: new Date(now.getTime() + STATE_LIFETIME_MS),
    });
    return googleDriveAuthorizationUrl(state);
  },

  async completeAuthorization(code: string, state: string): Promise<GoogleDriveIntegration> {
    const stateHash = createHash('sha256').update(state).digest('hex');
    const pending = await googleDriveRepository.consumeOAuthState(stateHash);
    if (!pending) throw new Error('Google Drive connection expired. Start the connection again.');

    const refreshToken = await exchangeGoogleDriveAuthorization(code);
    const file = await fetchGoogleDriveFile(
      refreshToken,
      pending.fileId,
      env.MAX_DOCUMENT_UPLOAD_BYTES,
    );
    const now = new Date();
    const record: GoogleDriveIntegrationRecord = {
      _id: randomUUID(),
      organizationId: pending.organizationId,
      ownerUserId: pending.ownerUserId,
      provider: 'google_drive',
      fileId: pending.fileId,
      fileName: file.name,
      mimeType: file.mimeType,
      accessRoles: pending.accessRoles,
      status: 'connected',
      refreshToken: encryptIntegrationToken(refreshToken),
      createdAt: now,
      updatedAt: now,
    };
    await googleDriveRepository.create(record);
    try {
      const acl = accessAcl(record.accessRoles);
      const collectionId = collectionIdFor(record._id);
      await documentCollectionsRepository.set(record.organizationId, collectionId, acl);
      const document = await documentsService.ingestFileContent(
        record.organizationId,
        record.ownerUserId,
        file.name,
        file.content,
        file.extension,
        collectionId,
        acl,
      );
      const contentHash = createHash('sha256').update(file.content).digest('hex');
      await googleDriveRepository.finishSync(record._id, record.organizationId, {
        status: 'ready',
        documentId: document.id,
        contentHash,
        lastSyncedAt: new Date(),
      });
    } catch (error) {
      await googleDriveRepository.finishSync(record._id, record.organizationId, {
        status: 'error',
        errorMessage: safeErrorMessage(error),
      });
      throw error;
    }
    const updated = await googleDriveRepository.find(record._id, record.organizationId);
    if (!updated) throw new GoogleDriveIntegrationNotFoundError();
    return publicIntegration(updated);
  },

  async sync(organizationId: string, integrationId: string): Promise<GoogleDriveIntegration> {
    const record = await googleDriveRepository.find(integrationId, organizationId);
    if (!record) throw new GoogleDriveIntegrationNotFoundError();
    if (!(await googleDriveRepository.claimSync(integrationId, organizationId))) {
      throw new GoogleDriveIntegrationBusyError();
    }
    try {
      const refreshToken = decryptIntegrationToken(record.refreshToken);
      const file = await fetchGoogleDriveFile(
        refreshToken,
        record.fileId,
        env.MAX_DOCUMENT_UPLOAD_BYTES,
      );
      const contentHash = createHash('sha256').update(file.content).digest('hex');
      const lastSyncedAt = new Date();
      if (record.contentHash === contentHash && record.documentId) {
        await googleDriveRepository.finishSync(integrationId, organizationId, {
          status: 'ready',
          contentHash,
          documentId: record.documentId,
          lastSyncedAt,
        });
      } else {
        const acl = accessAcl(record.accessRoles);
        const document = await documentsService.ingestFileContent(
          organizationId,
          record.ownerUserId,
          file.name,
          file.content,
          file.extension,
          collectionIdFor(integrationId),
          acl,
        );
        if (record.documentId)
          await documentsService.delete(organizationId, record.documentId, ['role:admin']);
        await googleDriveRepository.finishSync(integrationId, organizationId, {
          status: 'ready',
          documentId: document.id,
          contentHash,
          lastSyncedAt,
        });
      }
    } catch (error) {
      await googleDriveRepository.finishSync(integrationId, organizationId, {
        status: 'error',
        errorMessage: safeErrorMessage(error),
      });
      throw error;
    }
    const updated = await googleDriveRepository.find(integrationId, organizationId);
    if (!updated) throw new GoogleDriveIntegrationNotFoundError();
    return publicIntegration(updated);
  },

  async updateAccess(
    organizationId: string,
    integrationId: string,
    accessRoles: Array<'member' | 'viewer'>,
  ): Promise<GoogleDriveIntegration> {
    const updated = await googleDriveRepository.updateAccessRoles(
      integrationId,
      organizationId,
      accessRoles,
    );
    if (!updated) throw new GoogleDriveIntegrationNotFoundError();
    const collectionId = collectionIdFor(integrationId);
    await documentsService.shareCollection(organizationId, collectionId, {
      roles: accessRoles,
      userIds: [],
      groupIds: [],
    });
    await documentCollectionsRepository.set(organizationId, collectionId, accessAcl(accessRoles));
    return publicIntegration(updated);
  },

  async delete(organizationId: string, integrationId: string): Promise<void> {
    const record = await googleDriveRepository.find(integrationId, organizationId);
    if (!record) throw new GoogleDriveIntegrationNotFoundError();
    if (record.documentId)
      await documentsService.delete(organizationId, record.documentId, ['role:admin']);
    await googleDriveRepository.delete(integrationId, organizationId);
    await documentCollectionsRepository.delete(organizationId, collectionIdFor(integrationId));
  },
};
