import type { ChatCitation, DocumentRecord, RetrievalDebugChunk } from '@orgmind/shared';
import { env } from '../../config/env.js';
import { documentsRepository } from '../documents/documents.repository.js';
import { chunksRepository, type SimilarChunk } from '../documents/chunks.repository.js';
import { embeddingProvider } from '../documents/embedding.service.js';

export type RetrievalResult = {
  citations: ChatCitation[];
  debug: RetrievalDebugChunk[];
  context: string;
};

type RetrievalDependencies = {
  embed: (_query: string) => Promise<number[]>;
  search: (_vector: number[], _organizationId: string, _limit: number) => Promise<SimilarChunk[]>;
  hybridSearch?: (
    _query: string,
    _vector: number[],
    _organizationId: string,
    _limit: number,
    _weights: { vector: number; keyword: number },
  ) => Promise<SimilarChunk[]>;
  findDocuments: (
    _ids: string[],
    _organizationId: string,
  ) => Promise<Array<Pick<DocumentRecord, '_id' | 'originalName'>>>;
  limit: number;
  minimumScore: number;
  strategy?: 'vector' | 'hybrid';
  weights?: { vector: number; keyword: number };
};

const defaultDependencies: RetrievalDependencies = {
  embed: async (query) => {
    const [vector] = await embeddingProvider.embed([query], 'query');
    if (!vector) throw new Error('Could not create a search embedding for this question.');
    return Array.from(vector);
  },
  search: (vector, organizationId, limit) =>
    chunksRepository.searchSimilar(vector, organizationId, limit),
  hybridSearch: (query, vector, organizationId, limit, weights) =>
    chunksRepository.searchHybrid(query, vector, organizationId, limit, weights),
  findDocuments: (ids, organizationId) =>
    documentsRepository.findByIdsInOrganization(ids, organizationId),
  limit: env.CHAT_TOP_K,
  minimumScore: env.CHAT_MIN_RELEVANCE_SCORE,
  strategy: env.CHAT_RETRIEVAL_STRATEGY,
  weights: { vector: env.CHAT_VECTOR_SEARCH_WEIGHT, keyword: env.CHAT_KEYWORD_SEARCH_WEIGHT },
};

function createRetrievalService(dependencies: RetrievalDependencies) {
  return {
    async retrieve(query: string, organizationId: string): Promise<RetrievalResult> {
      const vector = await dependencies.embed(query);
      const results =
        dependencies.strategy === 'hybrid' && dependencies.hybridSearch
          ? await dependencies.hybridSearch(
              query,
              vector,
              organizationId,
              dependencies.limit,
              dependencies.weights ?? { vector: 1, keyword: 1 },
            )
          : await dependencies.search(vector, organizationId, dependencies.limit);
      const relevant =
        dependencies.strategy === 'hybrid'
          ? results
          : results.filter((result) => result.score >= dependencies.minimumScore);
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
          ...(result.retrievalDebug ? { retrievalDebug: result.retrievalDebug } : {}),
        }));
      const debug: RetrievalDebugChunk[] = relevant
        .filter((result) => documentNames.has(result.documentId) && result.retrievalDebug)
        .map((result) => ({
          ...result.retrievalDebug!,
          chunkId: result._id,
          documentName: documentNames.get(result.documentId) ?? 'Source document',
          chunkIndex: result.chunkIndex,
        }));
      return {
        citations,
        debug,
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

export function createVectorRetrievalService(dependencies = defaultDependencies) {
  return createRetrievalService({ ...dependencies, strategy: 'vector' });
}

export function createConfiguredRetrievalService(dependencies = defaultDependencies) {
  return createRetrievalService(dependencies);
}

export const retrievalService = createConfiguredRetrievalService();
