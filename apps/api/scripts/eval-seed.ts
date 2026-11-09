import { DocumentRecordSchema, DocumentChunkSchema } from '@orgmind/shared';
import { evaluationDocumentId, evaluationDocuments } from '@orgmind/evals';
import { env } from '../src/config/env.js';
import { closeConnections } from '../src/lib/connections.js';
import { logger } from '../src/lib/logger.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { chunkDocumentText } from '../src/modules/documents/chunking.service.js';
import { embeddingProvider } from '../src/modules/documents/embedding.service.js';
import { documentsRepository } from '../src/modules/documents/documents.repository.js';
import { chunksRepository } from '../src/modules/documents/chunks.repository.js';
import { documentIngestionRepository } from '../src/modules/documents/document-ingestion.repository.js';
import { localDocumentStorage } from '../src/modules/documents/document-storage.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { membershipsRepository } from '../src/modules/organizations/memberships.repository.js';

try {
  const organizationId = env.EVAL_ORGANIZATION_ID.trim();
  if (!organizationId)
    throw new Error('Set EVAL_ORGANIZATION_ID to a dedicated workspace ID in .env.');
  if (!env.GOOGLE_API_KEY)
    throw new Error('Set GOOGLE_API_KEY before seeding evaluation documents.');
  await runMigrations();
  const owner = await usersRepository.findByEmail(env.SEED_ADMIN_EMAIL);
  if (!owner) throw new Error('Run pnpm db:seed first to create the local admin account.');
  const membership = await membershipsRepository.findForUserInOrganization(
    owner.id,
    organizationId,
  );
  if (membership?.role !== 'admin') {
    throw new Error('The configured seed administrator must be an admin in EVAL_ORGANIZATION_ID.');
  }

  for (const fixture of evaluationDocuments) {
    const documentId = evaluationDocumentId(organizationId, fixture.key);
    const existing = await documentsRepository.findById(documentId);
    if (existing?.status === 'parsed' && existing.extractedText === fixture.text) {
      logger.info({ document: fixture.name }, 'Evaluation seed document is current.');
      continue;
    }
    if (existing) {
      await documentIngestionRepository.deleteDocumentAndChunks(documentId, organizationId);
      await localDocumentStorage.delete(existing.storageKey);
    }

    const storageKey = `${documentId}.md`;
    const now = new Date();
    const bytes = Buffer.from(fixture.text, 'utf8');
    const document = DocumentRecordSchema.parse({
      _id: documentId,
      organizationId,
      ownerId: owner.id,
      collectionId: 'default',
      acl: ['role:admin', 'role:member', 'role:viewer'],
      originalName: fixture.name,
      extension: 'md',
      mimeType: 'text/markdown',
      sizeBytes: bytes.byteLength,
      storageKey,
      status: 'uploaded',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await documentsRepository.create(document);
      await localDocumentStorage.write(storageKey, bytes);
      const textChunks = chunkDocumentText(fixture.text, {
        targetCharacters: env.CHUNK_TARGET_CHARACTERS,
        overlapCharacters: env.CHUNK_OVERLAP_CHARACTERS,
      });
      const vectors = await embeddingProvider.embed(
        textChunks.map((chunk) => chunk.text),
        'document',
      );
      const records = textChunks.map((chunk, index) => {
        const vector = vectors[index];
        if (!vector) throw new Error(`Missing embedding for evaluation document ${fixture.name}.`);
        return DocumentChunkSchema.parse({
          _id: `${documentId}:${chunk.chunkIndex}`,
          documentId,
          orgId: organizationId,
          collectionId: document.collectionId,
          acl: document.acl,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          headingPath: chunk.headingPath,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          embedding: Array.from(vector),
          createdAt: now,
        });
      });
      await documentIngestionRepository.commitChunks(documentId, fixture.text, records);
      logger.info(
        { document: fixture.name, chunks: records.length },
        'Seeded evaluation document.',
      );
    } catch (error) {
      await chunksRepository.deleteByDocument(documentId).catch(() => undefined);
      await documentsRepository.markFailed(
        documentId,
        error instanceof Error ? error.message : 'Evaluation seed failed.',
      );
      await localDocumentStorage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }
} catch (error) {
  logger.error({ err: error }, 'Evaluation documents could not be seeded.');
  process.exitCode = 1;
} finally {
  await closeConnections();
}
