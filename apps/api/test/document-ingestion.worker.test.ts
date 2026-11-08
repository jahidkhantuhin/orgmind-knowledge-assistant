import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord } from '@orgmind/shared';
import type { TextChunk } from '../src/modules/documents/chunking.service.js';
import {
  createDocumentIngestionProcessor,
  type IngestionJobData,
  type IngestionJobResult,
} from '../src/modules/documents/document-ingestion.queue.js';

const document: DocumentRecord = {
  _id: 'edac42f2-c30e-4ea8-9428-4757e3562212',
  organizationId: 'org-1',
  ownerId: 'user-1',
  collectionId: 'default',
  acl: ['role:admin', 'role:member', 'role:viewer'],
  originalName: 'handbook.txt',
  extension: 'txt',
  mimeType: 'text/plain',
  sizeBytes: 18,
  storageKey: 'edac42f2-c30e-4ea8-9428-4757e3562212.txt',
  status: 'uploaded',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function job(attemptsMade = 0, attempts = 3): Job<IngestionJobData, IngestionJobResult> {
  return {
    data: { documentId: document._id },
    attemptsMade,
    opts: { attempts },
  } as Job<IngestionJobData, IngestionJobResult>;
}

describe('document ingestion processor', () => {
  it('moves an uploaded document through parsing to parsed', async () => {
    const calls: string[] = [];
    const processor = createDocumentIngestionProcessor({
      findDocument: vi.fn().mockResolvedValue(document),
      markParsing: vi.fn(async () => void calls.push('parsing')),
      markChunking: vi.fn(async () => void calls.push('chunking')),
      markEmbedding: vi.fn(async () => void calls.push('embedding')),
      markParsed: vi.fn(
        async (_id, text, chunks) => void calls.push(`parsed:${text}:${chunks.length}`),
      ),
      markFailed: vi.fn(async (_id, reason) => void calls.push(`failed:${reason}`)),
      readFile: vi.fn().mockResolvedValue(Buffer.from('Handbook text')),
      extractText: vi.fn().mockResolvedValue('Handbook text'),
      chunkText: vi.fn().mockReturnValue([sampleChunk]),
      embedTexts: vi.fn().mockResolvedValue([new Float32Array([1, 0])]),
    });

    await expect(processor(job())).resolves.toEqual({
      documentId: document._id,
      characterCount: 'Handbook text'.length,
      chunkCount: 1,
    });
    expect(calls).toEqual(['parsing', 'chunking', 'embedding', 'parsed:Handbook text:1']);
  });

  it('marks a document failed after the final retry', async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const processor = createDocumentIngestionProcessor({
      findDocument: vi.fn().mockResolvedValue(document),
      markParsing: vi.fn().mockResolvedValue(undefined),
      markChunking: vi.fn().mockResolvedValue(undefined),
      markEmbedding: vi.fn().mockResolvedValue(undefined),
      markParsed: vi.fn().mockResolvedValue(undefined),
      markFailed,
      readFile: vi.fn().mockRejectedValue(new Error('disk unavailable')),
      extractText: vi.fn(),
      chunkText: vi.fn().mockReturnValue([sampleChunk]),
      embedTexts: vi.fn().mockResolvedValue([new Float32Array([1, 0])]),
    });

    await expect(processor(job(2, 3))).rejects.toThrow('disk unavailable');
    expect(markFailed).toHaveBeenCalledWith(document._id, 'disk unavailable');
  });

  it('leaves transient failures retryable before the last attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const processor = createDocumentIngestionProcessor({
      findDocument: vi.fn().mockResolvedValue(document),
      markParsing: vi.fn().mockResolvedValue(undefined),
      markChunking: vi.fn().mockResolvedValue(undefined),
      markEmbedding: vi.fn().mockResolvedValue(undefined),
      markParsed: vi.fn().mockResolvedValue(undefined),
      markFailed,
      readFile: vi.fn().mockRejectedValue(new Error('temporary disk error')),
      extractText: vi.fn(),
      chunkText: vi.fn().mockReturnValue([sampleChunk]),
      embedTexts: vi.fn().mockResolvedValue([new Float32Array([1, 0])]),
    });

    await expect(processor(job(0, 3))).rejects.toThrow('temporary disk error');
    expect(markFailed).not.toHaveBeenCalled();
  });
});

const sampleChunk: TextChunk = {
  chunkIndex: 0,
  text: 'Handbook text',
  headingPath: ['Handbook'],
  startOffset: 0,
  endOffset: 13,
};
