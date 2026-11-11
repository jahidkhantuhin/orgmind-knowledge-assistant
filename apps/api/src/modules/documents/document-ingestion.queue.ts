import { Queue, Worker, type Job, UnrecoverableError } from 'bullmq';
import type { DocumentRecord } from '@orgmind/shared';
import type { DocumentChunk } from '@orgmind/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { documentsRepository } from './documents.repository.js';
import { localDocumentStorage } from './document-storage.js';
import { extractDocumentText } from './text-extraction.service.js';
import { chunkDocumentText, type TextChunk } from './chunking.service.js';
import { embeddingProvider } from './embedding.service.js';
import { documentIngestionRepository } from './document-ingestion.repository.js';
import { contextualEnrichmentService } from './contextual-enrichment.service.js';

export const DOCUMENT_INGESTION_QUEUE = 'document-ingestion';

export type IngestionJobData = { documentId: string };
export type IngestionJobResult = { documentId: string; characterCount: number; chunkCount: number };

const redisUrl = new URL(env.REDIS_URL);

function redisConnection(maxRetriesPerRequest?: number | null) {
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
    password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
    db: Number(redisUrl.pathname.replace(/^\//, '') || 0),
    maxRetriesPerRequest,
    ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

export const documentIngestionQueue = new Queue<IngestionJobData, IngestionJobResult>(
  DOCUMENT_INGESTION_QUEUE,
  {
    connection: redisConnection(1),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000, jitter: 0.25 },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  },
);

type ProcessorDependencies = {
  findDocument: (_id: string) => Promise<DocumentRecord | null>;
  markParsing: (_id: string) => Promise<void>;
  markChunking: (_id: string) => Promise<void>;
  markEmbedding: (_id: string) => Promise<void>;
  updateProgress?: (_id: string, _progress: number) => Promise<void>;
  markParsed: (_id: string, _extractedText: string, _chunks: DocumentChunk[]) => Promise<void>;
  markFailed: (_id: string, _reason: string) => Promise<void>;
  readFile: (_key: string) => Promise<Buffer>;
  extractText: typeof extractDocumentText;
  chunkText: (_text: string) => TextChunk[];
  enrichTexts?: (_input: {
    organizationId: string;
    documentId: string;
    documentName: string;
    chunks: TextChunk[];
  }) => Promise<string[]>;
  embedTexts: (
    _texts: string[],
    _onProgress?: (_completed: number, _total: number) => void | Promise<void>,
  ) => Promise<Float32Array[]>;
};

const defaultDependencies: ProcessorDependencies = {
  findDocument: (id) => documentsRepository.findById(id),
  markParsing: (id) => documentsRepository.markParsing(id),
  markChunking: (id) => documentsRepository.markChunking(id),
  markEmbedding: (id) => documentsRepository.markEmbedding(id),
  updateProgress: (id, progress) => documentsRepository.updateProgress(id, progress),
  markParsed: (id, text, chunks) => documentIngestionRepository.commitChunks(id, text, chunks),
  markFailed: (id, reason) => documentsRepository.markFailed(id, reason),
  readFile: (key) => localDocumentStorage.read(key),
  extractText: extractDocumentText,
  chunkText: (text) =>
    chunkDocumentText(text, {
      targetCharacters: env.CHUNK_TARGET_CHARACTERS,
      overlapCharacters: env.CHUNK_OVERLAP_CHARACTERS,
    }),
  enrichTexts: (input) => contextualEnrichmentService.enrich(input),
  embedTexts: (texts, onProgress) => embeddingProvider.embed(texts, 'document', onProgress),
};

export function createDocumentIngestionProcessor(
  dependencies: ProcessorDependencies = defaultDependencies,
) {
  return async (job: Job<IngestionJobData, IngestionJobResult>): Promise<IngestionJobResult> => {
    const document = await dependencies.findDocument(job.data.documentId);
    if (!document) throw new UnrecoverableError('Document no longer exists.');
    if (document.status === 'parsed') {
      return {
        documentId: document._id,
        characterCount: document.extractedText?.length ?? 0,
        chunkCount: document.chunkCount ?? 0,
      };
    }

    await dependencies.markParsing(document._id);
    try {
      const file = await dependencies.readFile(document.storageKey);
      const extractedText = await dependencies.extractText(document.extension, file);
      await dependencies.markChunking(document._id);
      const textChunks = dependencies.chunkText(extractedText);
      if (textChunks.length === 0)
        throw new Error('No text chunks were created from this document.');
      const embeddingTexts = await dependencies.enrichTexts?.({
        organizationId: document.organizationId,
        documentId: document._id,
        documentName: document.originalName,
        chunks: textChunks,
      });
      const textsToEmbed = embeddingTexts ?? textChunks.map((chunk) => chunk.text);
      if (textsToEmbed.length !== textChunks.length) {
        throw new Error('The enrichment service returned a different text count than requested.');
      }
      await dependencies.markEmbedding(document._id);
      const embeddings = await dependencies.embedTexts(textsToEmbed, (completed, total) =>
        dependencies.updateProgress?.(document._id, 10 + (85 * completed) / total),
      );
      if (embeddings.length !== textChunks.length) {
        throw new Error('The embedding provider returned a different vector count than requested.');
      }
      const chunks = textChunks.map(
        (chunk, index): DocumentChunk => ({
          _id: `${document._id}:${chunk.chunkIndex}`,
          documentId: document._id,
          orgId: document.organizationId,
          collectionId: document.collectionId,
          acl: document.acl,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          headingPath: chunk.headingPath,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          embedding: Array.from(embeddings[index] ?? []),
          embeddingProfile: embeddingProvider.profile,
          createdAt: new Date(),
        }),
      );
      await dependencies.markParsed(document._id, extractedText, chunks);
      return {
        documentId: document._id,
        characterCount: extractedText.length,
        chunkCount: chunks.length,
      };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('Document processing failed.');
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await dependencies.markFailed(document._id, error.message);
      }
      throw error;
    }
  };
}

export function startDocumentIngestionWorker(): Worker<IngestionJobData, IngestionJobResult> {
  const worker = new Worker<IngestionJobData, IngestionJobResult>(
    DOCUMENT_INGESTION_QUEUE,
    createDocumentIngestionProcessor(),
    { connection: redisConnection(null), concurrency: 1 },
  );
  worker.on('failed', (job, error) => {
    logger.warn({ documentId: job?.data.documentId, err: error }, 'Document ingestion job failed');
  });
  worker.on('error', (error) => {
    logger.error({ err: error }, 'Document ingestion worker error');
  });
  return worker;
}

export async function closeDocumentIngestionQueue(): Promise<void> {
  await documentIngestionQueue.close();
}
