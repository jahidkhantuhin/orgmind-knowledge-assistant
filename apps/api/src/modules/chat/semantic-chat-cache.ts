import { createHash, randomUUID } from 'node:crypto';
import {
  ChatCitationSchema,
  RetrievalDebugChunkSchema,
  SecurityNoticeSchema,
  type ChatCitation,
  type RetrievalDebugChunk,
  type SecurityNotice,
} from '@orgmind/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { ensureRedisConnected, redisClient } from '../../lib/connections.js';

export type SemanticCachedAnswer = {
  answer: string;
  citations: ChatCitation[];
  retrievalDebug: RetrievalDebugChunk[];
  securityNotice?: SecurityNotice;
};

export type SemanticCacheScope = {
  organizationId: string;
  aclTokens: string[];
  modelId: string;
  embeddingProfile: string;
  historyFingerprint: string;
  retrievalFingerprint: string;
};

type StoredSemanticAnswer = SemanticCachedAnswer & { vector: number[] };

function bucketKey(scope: SemanticCacheScope): string {
  const scopeHash = createHash('sha256')
    .update(
      JSON.stringify({
        ...scope,
        aclTokens: [...scope.aclTokens].sort(),
      }),
    )
    .digest('hex');
  return `chat:semantic:v1:${scopeHash}`;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return -1;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function parseStoredAnswer(value: string): StoredSemanticAnswer | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const row = parsed as Record<string, unknown>;
    if (
      typeof row.answer !== 'string' ||
      !Array.isArray(row.vector) ||
      row.vector.some((item) => typeof item !== 'number' || !Number.isFinite(item)) ||
      !Array.isArray(row.citations) ||
      !Array.isArray(row.retrievalDebug)
    ) {
      return null;
    }
    const citations = row.citations.map((item) => ChatCitationSchema.parse(item));
    const retrievalDebug = row.retrievalDebug.map((item) => RetrievalDebugChunkSchema.parse(item));
    const securityNotice = SecurityNoticeSchema.safeParse(row.securityNotice);
    return {
      answer: row.answer,
      vector: row.vector,
      citations,
      retrievalDebug,
      ...(securityNotice.success ? { securityNotice: securityNotice.data } : {}),
    };
  } catch {
    return null;
  }
}

export const semanticChatCache = {
  async find(
    scope: SemanticCacheScope,
    vector: readonly number[],
  ): Promise<{ answer: SemanticCachedAnswer; similarity: number } | null> {
    if (!env.CHAT_SEMANTIC_CACHE_ENABLED) return null;
    try {
      await ensureRedisConnected();
      const bucket = bucketKey(scope);
      const itemKeys = await redisClient.lRange(
        `${bucket}:index`,
        0,
        env.CHAT_SEMANTIC_CACHE_MAX_ENTRIES - 1,
      );
      if (itemKeys.length === 0) return null;
      const values = await redisClient.mGet(itemKeys);
      let best: { answer: SemanticCachedAnswer; similarity: number } | null = null;
      for (const value of values) {
        if (!value) continue;
        const entry = parseStoredAnswer(value);
        if (!entry) continue;
        const similarity = cosineSimilarity(vector, entry.vector);
        if (
          similarity >= env.CHAT_SEMANTIC_CACHE_THRESHOLD &&
          (!best || similarity > best.similarity)
        ) {
          const { vector: _vector, ...answer } = entry;
          best = { answer, similarity };
        }
      }
      return best;
    } catch (error) {
      logger.warn(
        { err: error },
        'Semantic chat cache lookup failed; continuing without a cache hit.',
      );
      return null;
    }
  },

  async store(
    scope: SemanticCacheScope,
    vector: readonly number[],
    answer: SemanticCachedAnswer,
  ): Promise<void> {
    if (
      !env.CHAT_SEMANTIC_CACHE_ENABLED ||
      answer.citations.length === 0 ||
      answer.answer.trim().length === 0
    ) {
      return;
    }
    try {
      await ensureRedisConnected();
      const bucket = bucketKey(scope);
      const itemKey = `${bucket}:item:${randomUUID()}`;
      const entry: StoredSemanticAnswer = {
        ...answer,
        vector: [...vector],
      };
      await redisClient.set(itemKey, JSON.stringify(entry), {
        EX: env.CHAT_SEMANTIC_CACHE_TTL_SECONDS,
      });
      await redisClient.lPush(`${bucket}:index`, itemKey);
      await redisClient.lTrim(`${bucket}:index`, 0, env.CHAT_SEMANTIC_CACHE_MAX_ENTRIES - 1);
      await redisClient.expire(`${bucket}:index`, env.CHAT_SEMANTIC_CACHE_TTL_SECONDS);
    } catch (error) {
      logger.warn({ err: error }, 'Semantic chat cache store failed; answer generation succeeded.');
    }
  },
};
