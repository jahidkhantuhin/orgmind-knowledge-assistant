import { createHash, randomUUID } from 'node:crypto';
import {
  GitHubIntegrationSchema,
  type CreateGitHubIntegration,
  type GitHubIntegration,
} from '@orgmind/shared';
import { documentsService } from '../documents/documents.service.js';
import { documentCollectionsRepository } from '../documents/document-collections.repository.js';
import { aclTokensForGrant } from '../documents/document-acl.js';
import { encryptIntegrationToken, decryptIntegrationToken } from './integration-secrets.js';
import { integrationsRepository, type GitHubIntegrationRecord } from './integrations.repository.js';
import { readGithubFile, verifyGithubMcpAccess } from './github-mcp.client.js';

function publicIntegration(record: GitHubIntegrationRecord): GitHubIntegration {
  return GitHubIntegrationSchema.parse({
    id: record._id,
    organizationId: record.organizationId,
    provider: record.provider,
    owner: record.owner,
    repository: record.repository,
    branch: record.branch,
    path: record.path,
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
  return `github-${id}`;
}

function accessAcl(accessRoles: Array<'member' | 'viewer'>) {
  return aclTokensForGrant({ roles: accessRoles, userIds: [], groupIds: [] });
}

function safeErrorMessage(error: unknown, accessToken: string): string {
  const message = error instanceof Error ? error.message : 'GitHub content sync failed.';
  return message
    .replaceAll(accessToken, '[redacted]')
    .replace(/\b(?:github_pat_|gh[pousr]_)\w{20,}\b/g, '[redacted]')
    .slice(0, 500);
}

export class IntegrationBusyError extends Error {
  readonly statusCode = 409;
  readonly code = 'INTEGRATION_SYNCING';
  constructor() {
    super('This GitHub source is already syncing.');
    this.name = 'IntegrationBusyError';
  }
}

export class IntegrationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'INTEGRATION_NOT_FOUND';
  constructor() {
    super('GitHub integration not found.');
    this.name = 'IntegrationNotFoundError';
  }
}

export class GitHubConnectionError extends Error {
  readonly statusCode = 502;
  readonly code = 'GITHUB_MCP_CONNECTION_FAILED';
  constructor() {
    super('Could not connect to GitHub MCP. Check the repository access token and try again.');
    this.name = 'GitHubConnectionError';
  }
}

export const integrationsService = {
  async list(organizationId: string): Promise<GitHubIntegration[]> {
    return (await integrationsRepository.list(organizationId)).map(publicIntegration);
  },

  async create(
    organizationId: string,
    ownerUserId: string,
    input: CreateGitHubIntegration,
  ): Promise<GitHubIntegration> {
    try {
      await verifyGithubMcpAccess(input.accessToken, {
        owner: input.owner,
        repository: input.repository,
        branch: input.branch,
        path: input.path,
      });
    } catch {
      throw new GitHubConnectionError();
    }
    const now = new Date();
    const record: GitHubIntegrationRecord = {
      _id: randomUUID(),
      ownerUserId,
      organizationId,
      provider: 'github',
      owner: input.owner,
      repository: input.repository,
      branch: input.branch,
      path: input.path,
      accessRoles: input.accessRoles,
      status: 'connected',
      accessToken: encryptIntegrationToken(input.accessToken),
      createdAt: now,
      updatedAt: now,
    };
    await integrationsRepository.create(record);
    const acl = accessAcl(record.accessRoles);
    await documentCollectionsRepository.set(organizationId, collectionIdFor(record._id), acl);
    return publicIntegration(record);
  },

  async sync(organizationId: string, integrationId: string): Promise<GitHubIntegration> {
    const record = await integrationsRepository.find(integrationId, organizationId);
    if (!record) throw new IntegrationNotFoundError();
    if (!(await integrationsRepository.claimSync(integrationId, organizationId))) {
      throw new IntegrationBusyError();
    }
    const token = decryptIntegrationToken(record.accessToken);
    try {
      const content = await readGithubFile(token, {
        owner: record.owner,
        repository: record.repository,
        branch: record.branch,
        path: record.path,
      });
      const contents = Buffer.from(content, 'utf8');
      const contentHash = createHash('sha256').update(contents).digest('hex');
      const lastSyncedAt = new Date();
      if (record.contentHash === contentHash && record.documentId) {
        await integrationsRepository.finishSync(integrationId, organizationId, {
          status: 'ready',
          contentHash,
          documentId: record.documentId,
          lastSyncedAt,
        });
        const updated = await integrationsRepository.find(integrationId, organizationId);
        if (!updated) throw new IntegrationNotFoundError();
        return publicIntegration(updated);
      }

      const acl = accessAcl(record.accessRoles);
      const collectionId = collectionIdFor(integrationId);
      await documentCollectionsRepository.set(organizationId, collectionId, acl);
      const imported = await documentsService.ingestTextContent(
        organizationId,
        record.ownerUserId,
        record.path,
        contents,
        collectionId,
        acl,
      );
      if (record.documentId) {
        await documentsService.delete(organizationId, record.documentId, ['role:admin']);
      }
      await integrationsRepository.finishSync(integrationId, organizationId, {
        status: 'ready',
        documentId: imported.id,
        contentHash,
        lastSyncedAt,
      });
      const updated = await integrationsRepository.find(integrationId, organizationId);
      if (!updated) throw new IntegrationNotFoundError();
      return publicIntegration(updated);
    } catch (error) {
      await integrationsRepository.finishSync(integrationId, organizationId, {
        status: 'error',
        errorMessage: safeErrorMessage(error, token),
      });
      throw error;
    }
  },

  async updateAccess(
    organizationId: string,
    integrationId: string,
    accessRoles: Array<'member' | 'viewer'>,
  ): Promise<GitHubIntegration> {
    const updated = await integrationsRepository.updateAccessRoles(
      integrationId,
      organizationId,
      accessRoles,
    );
    if (!updated) throw new IntegrationNotFoundError();
    const collectionId = collectionIdFor(integrationId);
    const grants = { roles: accessRoles, userIds: [], groupIds: [] };
    await documentsService.shareCollection(organizationId, collectionId, grants);
    await documentCollectionsRepository.set(organizationId, collectionId, accessAcl(accessRoles));
    return publicIntegration(updated);
  },

  async delete(organizationId: string, integrationId: string): Promise<void> {
    const record = await integrationsRepository.find(integrationId, organizationId);
    if (!record) throw new IntegrationNotFoundError();
    if (record.documentId) {
      await documentsService.delete(organizationId, record.documentId, ['role:admin']);
    }
    await integrationsRepository.delete(integrationId, organizationId);
    await documentCollectionsRepository.delete(organizationId, collectionIdFor(integrationId));
  },
};
