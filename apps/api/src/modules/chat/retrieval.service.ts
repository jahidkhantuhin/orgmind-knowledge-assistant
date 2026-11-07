import type { ChatCitation, DocumentRecord } from '@orgmind/shared';
import { env } from '../../config/env.js';
import { documentsRepository } from '../documents/documents.repository.js';
import { chunksRepository, type SimilarChunk } from '../documents/chunks.repository.js';
import { embeddingProvider } from '../documents/embedding.service.js';

export type RetrievalResult = {
  citations: ChatCitation[];
  context: string;
};

type RetrievalDependencies = {
  embed: (_query: string) => Promise<number[]>;
  search: (_vector: number[], _organizationId: string, _limit: number) => Promise<SimilarChunk[]>;
  findDocuments: (
    _ids: string[],
    _organizationId: string,
  ) => Promise<Array<Pick<DocumentRecord, '_id' | 'originalName'>>>;
  limit: number;
  minimumScore: number;
};

const defaultDependencies: RetrievalDependencies = {
  embed: async (query) => {
    const [vector] = await embeddingProvider.embed([query], 'query');
    if (!vector) throw new Error('Could not create a search embedding for this question.');
    return Array.from(vector);
  },
  search: (vector, organizationId, limit) =>
    chunksRepository.searchSimilar(vector, organizationId, limit),
  findDocuments: (ids, organizationId) =>
    documentsRepository.findByIdsInOrganization(ids, organizationId),
  limit: env.CHAT_TOP_K,
  minimumScore: env.CHAT_MIN_RELEVANCE_SCORE,
};

export function createVectorRetrievalService(dependencies = defaultDependencies) {
  return {
    async retrieve(query: string, organizationId: string): Promise<RetrievalResult> {
      const vector = await dependencies.embed(query);
      const results = await dependencies.search(vector, organizationId, dependencies.limit);
      const relevant = results.filter((result) => result.score >= dependencies.minimumScore);
      const documentIds = [...new Set(relevant.map((result) => result.documentId))];
      const documents = await dependencies.findDocuments(documentIds, organizationId);
      const documentNames = new Map(
        documents.map((document) => [document._id, document.originalName]),
      );
      const citations: ChatCitation[] = relevant
        .filter((result) => documentNames.has(result.documentId))
        .map((result) => ({
          chunkId: result._id,
          documentId: result.documentId,
          documentName: documentNames.get(result.documentId) ?? 'Source document',
          chunkIndex: result.chunkIndex,
          headingPath: result.headingPath,
          passage: result.text.slice(0, 2_000),
          score: result.score,
        }));
      return {
        citations,
        context: citations
          .map(
            (citation, index) =>
              `[S${index + 1}] ${citation.documentName}${citation.headingPath.length ? ` — ${citation.headingPath.join(' / ')}` : ''}\n${citation.passage}`,
          )
          .join('\n\n'),
      };
    },
  };
}

export const vectorRetrievalService = createVectorRetrievalService();
