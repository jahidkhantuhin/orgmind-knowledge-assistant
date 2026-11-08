import type { DocumentChunk } from '@orgmind/shared';
import { mongoClient } from '../../lib/connections.js';
import { chunksRepository } from './chunks.repository.js';
import { documentsRepository } from './documents.repository.js';
import { contextualEnrichmentRepository } from './contextual-enrichment.repository.js';

export const documentIngestionRepository = {
  async commitChunks(
    documentId: string,
    extractedText: string,
    records: DocumentChunk[],
  ): Promise<void> {
    const session = mongoClient.startSession();
    try {
      await session.withTransaction(async () => {
        await chunksRepository.replaceForDocument(documentId, records, session);
        await documentsRepository.markParsed(documentId, extractedText, records.length, session);
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
