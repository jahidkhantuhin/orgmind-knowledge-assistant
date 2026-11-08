import { randomUUID } from 'node:crypto';
import {
  DocumentRecordSchema,
  DocumentDetailResponseSchema,
  DocumentSummarySchema,
  type DocumentExtension,
  type DocumentDetailResponse,
  type DocumentRecord,
  type DocumentSummary,
  type MembershipRole,
} from '@orgmind/shared';
import type { Express } from 'express';
import { logger } from '../../lib/logger.js';
import { documentIngestionQueue } from './document-ingestion.queue.js';
import { documentsRepository } from './documents.repository.js';
import { chunksRepository } from './chunks.repository.js';
import { documentIngestionRepository } from './document-ingestion.repository.js';
import { localDocumentStorage, mimeTypeForExtension } from './document-storage.js';
import { aclTokensForGrant, canReadAcl } from './document-acl.js';
import { documentCollectionsRepository } from './document-collections.repository.js';

function toSummary(document: DocumentRecord): DocumentSummary {
  return DocumentSummarySchema.parse({
    id: document._id,
    organizationId: document.organizationId,
    ownerId: document.ownerId,
    collectionId: document.collectionId,
    acl: document.acl,
    originalName: document.originalName,
    extension: document.extension,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    progress: document.progress,
    chunkCount: document.chunkCount,
    failureReason: document.failureReason,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    parsedAt: document.parsedAt?.toISOString(),
  });
}

export const documentsService = {
  async list(organizationId: string, aclTokens: string[]): Promise<DocumentSummary[]> {
    return (await documentsRepository.listByOrganization(organizationId, aclTokens)).map(toSummary);
  },

  async getDetail(
    organizationId: string,
    documentId: string,
    aclTokens: string[],
  ): Promise<DocumentDetailResponse | null> {
    const document = await documentsRepository.findByIdInOrganization(
      documentId,
      organizationId,
      aclTokens,
    );
    if (!document) return null;
    return DocumentDetailResponseSchema.parse({
      document: toSummary(document),
      chunks: await chunksRepository.listPreviewsByDocument(documentId),
    });
  },

  async listChunkPreviews(
    organizationId: string,
    documentId: string,
    afterChunkIndex: number,
    aclTokens: string[],
  ) {
    const document = await documentsRepository.findByIdInOrganization(
      documentId,
      organizationId,
      aclTokens,
    );
    if (!document) return null;
    return chunksRepository.listPreviewPageByDocument(documentId, afterChunkIndex);
  },

  async upload(
    organizationId: string,
    ownerId: string,
    file: Express.Multer.File,
    extension: DocumentExtension,
    collectionId = 'default',
    principalTokens: string[],
  ): Promise<DocumentSummary> {
    const now = new Date();
    const inheritedAcl = await documentCollectionsRepository.getOrCreate(
      organizationId,
      collectionId,
      ['role:admin', 'role:member', 'role:viewer'],
    );
    if (!canReadAcl(inheritedAcl, principalTokens)) {
      throw new DocumentAccessDeniedError();
    }
    const document = DocumentRecordSchema.parse({
      _id: randomUUID(),
      organizationId,
      ownerId,
      collectionId,
      acl: [...new Set([...inheritedAcl, `user:${ownerId}`])],
      originalName: file.originalname.replace(/[\\/]/g, '_').slice(0, 255),
      extension,
      mimeType: mimeTypeForExtension(extension),
      sizeBytes: file.size,
      storageKey: file.filename,
      status: 'uploaded',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await documentsRepository.create(document);
      await documentIngestionQueue.add(
        'ingest-document',
        { documentId: document._id },
        { jobId: document._id },
      );
    } catch (error) {
      await documentsRepository
        .deleteByIdInOrganization(document._id, organizationId)
        .catch(() => null);
      await localDocumentStorage.delete(document.storageKey).catch((cleanupError: unknown) => {
        logger.warn(
          { err: cleanupError, storageKey: document.storageKey },
          'Failed to clean up rejected upload',
        );
      });
      throw error;
    }

    return toSummary(document);
  },

  async shareCollection(
    organizationId: string,
    collectionId: string,
    grants: { roles: MembershipRole[]; userIds: string[]; groupIds: string[] },
  ): Promise<boolean> {
    const count = await documentIngestionRepository.updateCollectionAccess(
      organizationId,
      collectionId,
      aclTokensForGrant(grants),
    );
    return count > 0;
  },

  async getCollectionAccess(
    organizationId: string,
    collectionId: string,
  ): Promise<string[] | null> {
    return documentCollectionsRepository.get(organizationId, collectionId);
  },

  async shareDocument(
    organizationId: string,
    documentId: string,
    grants: { roles: MembershipRole[]; userIds: string[]; groupIds: string[] },
  ): Promise<boolean> {
    return documentIngestionRepository.updateDocumentAccess(
      organizationId,
      documentId,
      aclTokensForGrant(grants),
    );
  },

  async delete(organizationId: string, documentId: string, aclTokens: string[]): Promise<boolean> {
    const accessible = await documentsRepository.findByIdInOrganization(
      documentId,
      organizationId,
      aclTokens,
    );
    if (!accessible) return false;
    const document = await documentIngestionRepository.deleteDocumentAndChunks(
      documentId,
      organizationId,
    );
    if (!document) return false;

    try {
      const job = await documentIngestionQueue.getJob(document._id);
      if (job && (await job.getState()) !== 'active') await job.remove();
    } catch (error) {
      logger.warn(
        { err: error, documentId },
        'Could not remove queued document job during deletion',
      );
    }
    try {
      await localDocumentStorage.delete(document.storageKey);
    } catch (error) {
      logger.error({ err: error, documentId }, 'Could not remove local document file');
    }
    return true;
  },

  async reingest(
    organizationId: string,
    documentId: string,
    aclTokens: string[],
  ): Promise<DocumentSummary | null> {
    const document = await documentsRepository.findByIdInOrganization(
      documentId,
      organizationId,
      aclTokens,
    );
    if (!document) return null;
    if (['parsing', 'chunking', 'embedding'].includes(document.status)) {
      throw new DocumentBusyError();
    }

    const existingJob = await documentIngestionQueue.getJob(documentId);
    if (existingJob) {
      if ((await existingJob.getState()) === 'active') throw new DocumentBusyError();
      await existingJob.remove();
    }

    const queued = await documentsRepository.queueForReingestion(documentId, organizationId);
    if (!queued) throw new DocumentBusyError();
    try {
      await documentIngestionQueue.add('ingest-document', { documentId }, { jobId: documentId });
    } catch (error) {
      await documentsRepository.markFailed(documentId, 'Could not queue document re-ingestion.');
      throw error;
    }

    const updated = await documentsRepository.findByIdInOrganization(documentId, organizationId);
    if (!updated) return null;
    return toSummary(updated);
  },
};

export class DocumentBusyError extends Error {
  readonly statusCode = 409;
  readonly code = 'DOCUMENT_PROCESSING';

  constructor() {
    super('This document is already being processed. Try again when it is finished.');
    this.name = 'DocumentBusyError';
  }
}

export class DocumentAccessDeniedError extends Error {
  readonly statusCode = 403;
  readonly code = 'DOCUMENT_ACCESS_DENIED';
  constructor() {
    super('You do not have access to this folder.');
    this.name = 'DocumentAccessDeniedError';
  }
}
