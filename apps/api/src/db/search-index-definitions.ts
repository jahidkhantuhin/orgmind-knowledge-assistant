import { env } from '../config/env.js';

export const CHUNKS_VECTOR_INDEX_NAME = 'chunks_vector_index';
export const CHUNKS_TEXT_INDEX_NAME = 'chunks_text_index';

export const chunksVectorSearchDefinition = {
  fields: [
    {
      type: 'vector',
      path: 'embedding',
      numDimensions: env.EMBEDDING_DIMENSIONS,
      similarity: 'cosine',
      quantization: 'scalar',
    },
    { type: 'filter', path: 'orgId' },
    { type: 'filter', path: 'collectionId' },
    { type: 'filter', path: 'acl' },
    { type: 'filter', path: 'documentId' },
    { type: 'filter', path: 'embeddingProfile' },
  ],
};

export const chunksTextSearchDefinition = {
  mappings: {
    dynamic: false,
    fields: {
      text: { type: 'string' },
      orgId: { type: 'token' },
      collectionId: { type: 'token' },
      acl: { type: 'token' },
      documentId: { type: 'token' },
      embeddingProfile: { type: 'token' },
    },
  },
};
