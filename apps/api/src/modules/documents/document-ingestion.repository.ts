import type { DocumentChunk } from '@orgmind/shared';
import { mongoClient } from '../../lib/connections.js';
import { chunksRepository } from './chunks.repository.js';
import { documentsRepository } from './documents.repository.js';
import { contextualEnrichmentRepository } from './contextual-enrichment.repository.js';
import { documentCollectionsRepository } from './document-collections.repository.js';

export const documentIngestionRepository = {
  async updateCollectionAccess(
    organizationId: string,
    collectionId: string,
    acl: string[],
  ): Promise<number> {
    const session = mongoClient.startSession();
    let matchedCount = 0;
    try {
      await session.withTransaction(async () => {
        matchedCount = await documentsRepository.updateCollectionAccess(
          organizationId,
          collectionId,
          acl,
          session,
        );
        if (matchedCount > 0) {
          await documentCollectionsRepository.set(organizationId, collectionId, acl, session);
          await chunksRepository.updateAccessForCollection(
            organizationId,
            collectionId,
            acl,
            session,
          );
        }
      });
      return matchedCount;
    } finally {
      await session.endSession();
    }
  },
  async updateDocumentAccess(
    organizationId: string,
    documentId: string,
    acl: string[],
  ): Promise<boolean> {
    const session = mongoClient.startSession();
    let updated = false;
    try {
      await session.withTransaction(async () => {
        updated = await documentsRepository.updateDocumentAccess(
          organizationId,
          documentId,
          acl,
          session,
        );
        if (updated) {
          await chunksRepository.updateAccessForDocument(organizationId, documentId, acl, session);
        }
      });
      return updated;
    } finally {
      await session.endSession();
    }
  },
  async commitChunks(
    documentId: string,
    extractedText: string,
    records: DocumentChunk[],
  ): Promise<void> {
    const session = mongoClient.startSession();
    try {
      await session.withTransaction(async () => {
        const document = await documentsRepository.findById(documentId, session);
        if (!document) throw new Error('Document was removed before ingestion completed.');
        const currentRecords = records.map((record) => ({
          ...record,
          collectionId: document.collectionId,
          acl: document.acl,
        }));
        await chunksRepository.replaceForDocument(documentId, currentRecords, session);
        await documentsRepository.markParsed(
          documentId,
          extractedText,
          currentRecords.length,
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  },

  async deleteDocumentAndChunks(
    documentId: string,
    organizationId: string,
  ): Promise<Awaited<ReturnType<typeof documentsRepository.findById>> | null> {
    const session = mongoClient.startSession();
    let document: Awaited<ReturnType<typeof documentsRepository.findById>> | null = null;
    try {
      await session.withTransaction(async () => {
        document = await documentsRepository.deleteByIdInOrganization(
          documentId,
          organizationId,
          session,
        );
        if (document) {
          await chunksRepository.deleteByDocument(documentId, session);
          await contextualEnrichmentRepository.deleteByDocument(
            documentId,
            organizationId,
            session,
          );
        }
      });
      return document;
    } finally {
      await session.endSession();
    }
  },
};
