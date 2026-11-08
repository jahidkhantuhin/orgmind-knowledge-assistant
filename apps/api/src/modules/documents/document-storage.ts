import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import multer from 'multer';
import { DocumentExtensionSchema, type DocumentExtension } from '@orgmind/shared';
import { env } from '../../config/env.js';

const storageDirectory = resolve(process.cwd(), env.UPLOAD_STORAGE_DIR);

const mimeTypes: Record<DocumentExtension, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  txt: 'text/plain',
};

const acceptedMimeTypes: Record<DocumentExtension, string[]> = {
  pdf: ['application/pdf', 'application/octet-stream'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ],
  md: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream'],
  txt: ['text/plain', 'application/octet-stream'],
};

export class UploadInputError extends Error {
  readonly statusCode = 415;
  readonly code = 'UNSUPPORTED_FILE_TYPE';

  constructor() {
    super('Upload a PDF, DOCX, Markdown, or plain text file.');
    this.name = 'UploadInputError';
  }
}

export function extensionForFilename(filename: string): DocumentExtension | null {
  const extension = extname(filename).slice(1).toLowerCase();
  const result = DocumentExtensionSchema.safeParse(extension);
  return result.success ? result.data : null;
}

export function mimeTypeForExtension(extension: DocumentExtension): string {
  return mimeTypes[extension];
}

export const uploadDocumentFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      void mkdir(storageDirectory, { recursive: true }).then(
        () => callback(null, storageDirectory),
        (error: Error) => callback(error, storageDirectory),
      );
    },
    filename: (_req, file, callback) => {
      const extension = extensionForFilename(file.originalname);
      if (!extension || !acceptedMimeTypes[extension].includes(file.mimetype.toLowerCase())) {
        callback(new UploadInputError(), '');
        return;
      }
      callback(null, `${randomUUID()}.${extension}`);
    },
  }),
  limits: {
    fileSize: env.MAX_DOCUMENT_UPLOAD_BYTES,
    files: 1,
    fields: 1,
    parts: 2,
  },
}).single('file');

function resolveStorageKey(storageKey: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|docx|md|txt)$/i.test(
      storageKey,
    )
  ) {
    throw new Error('Invalid document storage key.');
  }
  return resolve(storageDirectory, storageKey);
}

export const localDocumentStorage = {
  async read(storageKey: string): Promise<Buffer> {
    return readFile(resolveStorageKey(storageKey));
  },

  async delete(storageKey: string): Promise<void> {
    await rm(resolveStorageKey(storageKey), { force: true });
  },
};
