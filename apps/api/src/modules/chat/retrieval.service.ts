import type {
  ChatCitation,
  DocumentRecord,
  RetrievalDebug,
  RetrievalDebugChunk,
} from '@orgmind/shared';
import { env } from '../../config/env.js';
import { documentsRepository } from '../documents/documents.repository.js';
import { chunksRepository, type SimilarChunk } from '../documents/chunks.repository.js';
import { embeddingProvider } from '../documents/embedding.service.js';
import { retrievalSettingsRepository } from '../organizations/retrieval-settings.repository.js';
import { logger } from '../../lib/logger.js';
import { queryRewritingService, type QueryRewriter } from './query-rewriting.service.js';
import { reranker, type Reranker } from './reranker.service.js';

export type RetrievalResult = {
  citations: ChatCitation[];
  debug: RetrievalDebugChunk[];
  context: string;
};

type RankedCandidate = SimilarChunk & {
  retrievalDebug: RetrievalDebug;
  rerankRank?: number;
  rerankScore?: number;
};

type RetrievalDependencies = {
  embed: (_query: string) => Promise<number[]>;
  search: (
    _vector: number[],
    _organizationId: string,
    _aclTokens: string[],
    _limit: number,
  ) => Promise<SimilarChunk[]>;
  hybridSearch?: (
    _query: string,
    _vector: number[],
    _organizationId: string,
    _aclTokens: string[],
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
  candidateCount?: number;
  getSettings?: (_organizationId: string) => Promise<{
    rerankingEnabled: boolean;
    queryRewriteEnabled: boolean;
  }>;
  queryRewriter?: QueryRewriter;
  reranker?: Reranker;
};

const defaultDependencies: RetrievalDependencies = {
  embed: async (query) => {
    const [vector] = await embeddingProvider.embed([query], 'query');
    if (!vector) throw new Error('Could not create a search embedding for this question.');
    return Array.from(vector);
  },
  search: (vector, organizationId, aclTokens, limit) =>
    chunksRepository.searchSimilar(vector, organizationId, aclTokens, limit),
  hybridSearch: (query, vector, organizationId, aclTokens, limit, weights) =>
    chunksRepository.searchHybrid(query, vector, organizationId, aclTokens, limit, weights),
  findDocuments: (ids, organizationId) =>
    documentsRepository.findByIdsInOrganization(ids, organizationId),
  limit: env.CHAT_TOP_K,
  minimumScore: env.CHAT_MIN_RELEVANCE_SCORE,
  strategy: env.CHAT_RETRIEVAL_STRATEGY,
  weights: { vector: env.CHAT_VECTOR_SEARCH_WEIGHT, keyword: env.CHAT_KEYWORD_SEARCH_WEIGHT },
  candidateCount: env.CHAT_RERANK_CANDIDATE_COUNT,
  getSettings: (organizationId) => retrievalSettingsRepository.get(organizationId),
  queryRewriter: queryRewritingService,
  reranker,
};

function createRetrievalService(dependencies: RetrievalDependencies) {
  return {
    async retrieve(
      query: string,
      organizationId: string,
      aclTokens: string[],
    ): Promise<RetrievalResult> {
      const settings = await dependencies.getSettings?.(organizationId);
      let searchQuery = query;
      if (settings?.queryRewriteEnabled && dependencies.queryRewriter) {
        try {
          searchQuery = await dependencies.queryRewriter.rewrite(query);
        } catch (error) {
          logger.warn(
            { err: error, organizationId },
            'Query rewriting failed; using the original query.',
          );
        }
      }
      const rerankingEnabled =
        settings?.rerankingEnabled === true && dependencies.reranker?.available === true;
      const candidateLimit = rerankingEnabled
        ? (dependencies.candidateCount ?? dependencies.limit)
        : dependencies.limit;
      const vector = await dependencies.embed(searchQuery);
      const results =
        dependencies.strategy === 'hybrid' && dependencies.hybridSearch
          ? await dependencies.hybridSearch(
              searchQuery,
              vector,
              organizationId,
              aclTokens,
              candidateLimit,
              dependencies.weights ?? { vector: 1, keyword: 1 },
            )
          : await dependencies.search(vector, organizationId, aclTokens, candidateLimit);
      const eligible =
        dependencies.strategy === 'hybrid'
          ? results
          : results.filter((result) => result.score >= dependencies.minimumScore);
      let ranked: RankedCandidate[] = eligible.map((result, index) => ({
        ...result,
        retrievalDebug: result.retrievalDebug ?? {
          vectorRank: index + 1,
          vectorScore: result.score,
          keywordRank: null,
          keywordScore: null,
          fusedScore: result.score,
        },
      }));
      if (rerankingEnabled && dependencies.reranker) {
        try {
          const reranked = await dependencies.reranker.rerank(searchQuery, ranked, ranked.length);
          if (reranked.length > 0) {
            const rerankedIds = new Set(reranked.map((result) => result._id));
            const debugById = new Map(ranked.map((result) => [result._id, result.retrievalDebug]));
            ranked = [
              ...reranked.map((result) => ({
                ...result,
                retrievalDebug: result.retrievalDebug ?? debugById.get(result._id)!,
              })),
              ...ranked.filter((result) => !rerankedIds.has(result._id)),
            ];
          }
        } catch (error) {
          logger.warn(
            { err: error, organizationId },
            'Reranking failed; using fused search order.',
          );
        }
      }
      const selected = ranked.slice(0, dependencies.limit);
      const documentIds = [...new Set(ranked.map((result) => result.documentId))];
      const documents = await dependencies.findDocuments(documentIds, organizationId);
      const documentNames = new Map(
        documents.map((document) => [document._id, document.originalName]),
      );
      const citations: ChatCitation[] = selected
        .filter((result) => documentNames.has(result.documentId))
        .map((result) => ({
          chunkId: result._id,
          documentId: result.documentId,
          documentName: documentNames.get(result.documentId) ?? 'Source document',
          chunkIndex: result.chunkIndex,
          headingPath: result.headingPath,
          passage: result.text.slice(0, 2_000),
          score: result.score,
          ...(result.retrievalDebug
            ? {
                retrievalDebug: {
                  ...result.retrievalDebug,
                  fusedRank:
                    eligible.findIndex((candidate) => candidate._id === result._id) + 1 || null,
                  ...(result.rerankRank ? { rerankRank: result.rerankRank } : {}),
                  ...(result.rerankScore !== undefined ? { rerankScore: result.rerankScore } : {}),
                },
              }
            : {}),
        }));
      const debug: RetrievalDebugChunk[] = ranked
        .filter((result) => documentNames.has(result.documentId) && result.retrievalDebug)
        .map((result) => ({
          ...result.retrievalDebug!,
          chunkId: result._id,
          documentId: result.documentId,
          documentName: documentNames.get(result.documentId) ?? 'Source document',
          chunkIndex: result.chunkIndex,
          fusedRank: eligible.findIndex((candidate) => candidate._id === result._id) + 1 || null,
          ...(result.rerankRank ? { rerankRank: result.rerankRank } : {}),
          ...(result.rerankScore !== undefined ? { rerankScore: result.rerankScore } : {}),
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
