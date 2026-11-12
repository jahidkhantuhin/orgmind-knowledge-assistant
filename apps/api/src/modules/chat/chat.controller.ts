import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import {
  ChatRequestSchema,
  citationsReferencedInAnswer,
  ConversationListResponseSchema,
  ConversationMessagesResponseSchema,
  ConversationSummarySchema,
  ChatMessageResponseSchema,
  CreateConversationSchema,
  RenameConversationSchema,
  type RetrievalDebugChunk,
  type ChatObservability,
  type SecurityNotice,
} from '@orgmind/shared';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  streamText,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import type { ChatCitation } from '@orgmind/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { chatRepository } from './chat.repository.js';
import { chatModelProvider } from './chat-model.provider.js';
import { routeChatModel } from './model-routing.js';
import { semanticChatCache, type SemanticCacheScope } from './semantic-chat-cache.js';
import { embeddingProvider } from '../documents/embedding.service.js';
import {
  createAgenticRetrievalService,
  retrievalService,
  type RetrievalResult,
} from './retrieval.service.js';
import { LOW_CONFIDENCE_ANSWER, buildGroundedSystemPrompt } from './prompt.builder.js';
import { isLowConfidenceAnswer } from './chat-confidence.js';
import { aclTokensForPrincipal } from '../documents/document-acl.js';
import { documentsRepository } from '../documents/documents.repository.js';
import { activeTraceId, withSpan } from '../../lib/telemetry.js';
import { estimateTokenCostUsd } from './usage-metrics.js';
import { createAgenticRagService } from './agentic-rag.service.js';
import type { AgentStep } from './agentic-rag.graph.js';
import { auditLogsRepository } from '../audit/audit-logs.repository.js';
import { retrievalSettingsRepository } from '../organizations/retrieval-settings.repository.js';
import {
  createPiiRedactionTransform,
  looksLikePromptInjection,
  redactPii,
  secureAssistantAnswer,
  secureRetrievedEvidence,
  securityNoticeFor,
} from './security-guardrails.js';

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toConversationSummary(
  record: Awaited<ReturnType<typeof chatRepository.createConversation>>,
) {
  return ConversationSummarySchema.parse({
    id: record._id,
    organizationId: record.organizationId,
    title: record.title,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function toMessageResponse(record: Awaited<ReturnType<typeof chatRepository.addMessage>>) {
  return ChatMessageResponseSchema.parse({
    id: record._id,
    role: record.role,
    content: record.content,
    citations: citationsReferencedInAnswer(record.content, record.citations),
    retrievalDebug: record.retrievalDebug,
    observability: record.observability,
    securityNotice: record.securityNotice,
    createdAt: record.createdAt.toISOString(),
  });
}

async function messagesWithCurrentAccess(
  messages: Awaited<ReturnType<typeof chatRepository.listMessages>>,
  organizationId: string,
  aclTokens: string[],
) {
  const documentIds = [
    ...new Set(
      messages.flatMap((message) =>
        message.role === 'assistant'
          ? [
              ...message.citations.map((citation) => citation.documentId),
              ...message.retrievalDebug.flatMap((item) =>
                item.documentId ? [item.documentId] : [],
              ),
            ]
          : [],
      ),
    ),
  ];
  const accessibleDocuments = await documentsRepository.findByIdsInOrganization(
    documentIds,
    organizationId,
    aclTokens,
  );
  const accessibleIds = new Set(accessibleDocuments.map((document) => document._id));
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') return [message];
    if (message.citations.some((citation) => !accessibleIds.has(citation.documentId))) return [];
    return [
      {
        ...message,
        retrievalDebug: message.retrievalDebug.filter(
          (item) => item.documentId && accessibleIds.has(item.documentId),
        ),
      },
    ];
  });
}

export const listConversationsController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const userId = req.authSession?.user.id;
  if (!organizationId || !userId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Organization is required.' } });
    return;
  }
  const conversations = await chatRepository.listConversations(organizationId, userId);
  res.json(
    ConversationListResponseSchema.parse({
      conversations: conversations.map(toConversationSummary),
    }),
  );
};

export const createConversationController: RequestHandler = async (req, res) => {
  const userId = req.authSession?.user.id;
  const parsed = CreateConversationSchema.safeParse(req.body);
  if (!parsed.success || !userId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_CONVERSATION', message: 'Workspace is required.' } });
    return;
  }
  const conversation = await chatRepository.createConversation(parsed.data.organizationId, userId);
  res.status(201).json({ conversation: toConversationSummary(conversation) });
};

export const getConversationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const conversationId = routeParam(req.params.conversationId);
  const userId = req.authSession?.user.id;
  if (!organizationId || !conversationId || !userId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_CONVERSATION', message: 'Conversation is required.' } });
    return;
  }
  const conversation = await chatRepository.findConversation(
    conversationId,
    organizationId,
    userId,
  );
  if (!conversation) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    return;
  }
  const aclTokens = aclTokensForPrincipal(
    userId,
    req.membership?.role ?? 'viewer',
    req.membership?.groupIds ?? [],
  );
  const messages = await messagesWithCurrentAccess(
    await chatRepository.listMessages(conversationId),
    organizationId,
    aclTokens,
  );
  res.json(
    ConversationMessagesResponseSchema.parse({
      conversation: toConversationSummary(conversation),
      messages: messages.map(toMessageResponse),
    }),
  );
};

export const renameConversationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const conversationId = routeParam(req.params.conversationId);
  const userId = req.authSession?.user.id;
  const parsed = RenameConversationSchema.safeParse(req.body);
  if (!organizationId || !conversationId || !userId || !parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_CONVERSATION', message: 'Enter a valid conversation title.' },
    });
    return;
  }
  const conversation = await chatRepository.renameConversation(
    conversationId,
    organizationId,
    userId,
    parsed.data.title,
  );
  if (!conversation) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    return;
  }
  res.json({ conversation: toConversationSummary(conversation) });
};

export const deleteConversationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const conversationId = routeParam(req.params.conversationId);
  const userId = req.authSession?.user.id;
  if (!organizationId || !conversationId || !userId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_CONVERSATION', message: 'Conversation is required.' } });
    return;
  }
  const deleted = await chatRepository.deleteConversation(conversationId, organizationId, userId);
  if (!deleted) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    return;
  }
  res.status(204).end();
};

function textFromLastUserMessage(messages: unknown[]): string | null {
  const value = messages.at(-1);
  if (!value || typeof value !== 'object') return null;
  const message = value as { role?: unknown; parts?: unknown };
  if (message.role !== 'user' || !Array.isArray(message.parts)) return null;
  const text = message.parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join(' ')
    .trim();
  return text.length > 0 && text.length <= 2_000 ? text : null;
}

export const streamChatController: RequestHandler = async (req, res) => {
  await withSpan('chat.request', async () => {
    const userId = req.authSession?.user.id;
    const parsed = ChatRequestSchema.safeParse(req.body);
    const organizationId = routeParam(req.params.organizationId);
    if (
      !userId ||
      !organizationId ||
      !parsed.success ||
      parsed.data.organizationId !== organizationId
    ) {
      res.status(400).json({
        error: { code: 'INVALID_CHAT_REQUEST', message: 'Your question could not be sent.' },
      });
      return;
    }
    const question = textFromLastUserMessage(parsed.data.messages);
    if (!question) {
      res.status(400).json({
        error: { code: 'INVALID_QUESTION', message: 'Enter a question under 2,000 characters.' },
      });
      return;
    }
    const conversation = await chatRepository.findConversation(
      parsed.data.conversationId,
      organizationId,
      userId,
    );
    if (!conversation) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
      return;
    }

    const requester = req.authSession!.user;
    const questionRedaction = env.CHAT_PII_REDACTION_ENABLED
      ? redactPii(question)
      : { text: question, count: 0 };
    if (looksLikePromptInjection(question)) {
      await auditLogsRepository
        .record({
          organizationId,
          actorUserId: userId,
          actorName: requester.name,
          actorEmail: requester.email,
          outcome: 'blocked',
          question: questionRedaction.text,
        })
        .catch((error: unknown) =>
          logger.error({ err: error }, 'Could not record a blocked chat request.'),
        );
      res.status(403).json({
        error: {
          code: 'SECURITY_BLOCKED',
          message:
            'This question appears to ask OrgMind to override its safety instructions. Rephrase it as a question about your workspace documents.',
        },
      });
      return;
    }
    const safeQuestion = questionRedaction.text;
    const selectedModel = routeChatModel(safeQuestion, parsed.data.modelPreference);
    let securityNotice = securityNoticeFor(0, questionRedaction.count);

    if (env.CHAT_PROVIDER === 'google' && !env.GOOGLE_API_KEY) {
      res.status(503).json({
        error: {
          code: 'CHAT_NOT_CONFIGURED',
          message: 'Set GOOGLE_API_KEY before starting a Google-powered chat.',
        },
      });
      return;
    }
    await chatRepository.addMessage({
      organizationId,
      conversationId: conversation._id,
      userId,
      role: 'user',
      content: safeQuestion,
      citations: [],
    });
    const aclTokens = aclTokensForPrincipal(
      userId,
      req.membership?.role ?? 'viewer',
      req.membership?.groupIds ?? [],
    );
    const priorMessages = await messagesWithCurrentAccess(
      await chatRepository.listMessages(conversation._id),
      organizationId,
      aclTokens,
    );
    const requestStartedAt = performance.now();
    const auditDocuments = new Map<string, string>();
    const collectAuditDocuments = (result: RetrievalResult) => {
      for (const source of [...result.citations, ...result.debug]) {
        if ('documentId' in source && source.documentId) {
          auditDocuments.set(source.documentId, source.documentName);
        }
      }
    };
    let injectionPassagesBlocked = 0;
    let piiValuesRedacted = questionRedaction.count;
    let retrieval: RetrievalResult | undefined;
    let citations: ChatCitation[] = [];
    let retrievalDebug: RetrievalDebugChunk[] = [];
    let cachedAnswer: { answer: string; similarity: number } | undefined;
    let cacheScope: SemanticCacheScope | undefined;
    let cacheVector: number[] | undefined;
    let cacheLookupMs = 0;
    if (parsed.data.mode === 'simple') {
      const settings = await retrievalSettingsRepository.get(organizationId);
      const canUseSemanticCache = env.CHAT_SEMANTIC_CACHE_ENABLED && !settings.queryRewriteEnabled;
      if (canUseSemanticCache) {
        const modelHistory = priorMessages
          .slice(0, -1)
          .map(({ role, content }) => ({ role, content }));
        const historyFingerprint = createHash('sha256')
          .update(JSON.stringify(modelHistory))
          .digest('hex');
        cacheScope = {
          organizationId,
          aclTokens,
          modelId: `${env.CHAT_PROVIDER}:${selectedModel.modelId}`,
          embeddingProfile: embeddingProvider.profile,
          historyFingerprint,
          retrievalFingerprint: JSON.stringify({
            strategy: env.CHAT_RETRIEVAL_STRATEGY,
            topK: env.CHAT_TOP_K,
            minimumScore: env.CHAT_MIN_RELEVANCE_SCORE,
            rerankingEnabled: settings.rerankingEnabled,
            rerankModel: env.COHERE_RERANK_MODEL,
            rerankCandidateCount: env.CHAT_RERANK_CANDIDATE_COUNT,
            vectorWeight: env.CHAT_VECTOR_SEARCH_WEIGHT,
            keywordWeight: env.CHAT_KEYWORD_SEARCH_WEIGHT,
          }),
        };
        const cacheStartedAt = performance.now();
        const [queryEmbedding] = await withSpan(
          'chat.embedding',
          () => embeddingProvider.embed([safeQuestion], 'query'),
          { 'orgmind.embedding.model': embeddingProvider.model },
        );
        cacheLookupMs = performance.now() - cacheStartedAt;
        if (queryEmbedding) {
          cacheVector = Array.from(queryEmbedding);
          const found = await semanticChatCache.find(cacheScope, cacheVector);
          if (found) {
            const documentIds = [
              ...new Set(found.answer.citations.map((citation) => citation.documentId)),
            ];
            const accessible = await documentsRepository.findByIdsInOrganization(
              documentIds,
              organizationId,
              aclTokens,
            );
            if (accessible.length === documentIds.length) {
              cachedAnswer = { answer: found.answer.answer, similarity: found.similarity };
              citations = found.answer.citations;
              retrievalDebug = found.answer.retrievalDebug.filter(
                (item) =>
                  item.documentId &&
                  accessible.some((document) => document._id === item.documentId),
              );
              securityNotice = found.answer.securityNotice ?? securityNotice;
              retrieval = {
                citations,
                debug: retrievalDebug,
                context: '',
                latencyMs: {
                  embedding: cacheLookupMs,
                  search: 0,
                  rerank: 0,
                  total: cacheLookupMs,
                },
              };
            }
          }
        }
      }
      if (!cachedAnswer) {
        const rawRetrieval = await retrievalService.retrieve(
          safeQuestion,
          organizationId,
          aclTokens,
          cacheVector ? { embedding: cacheVector, embeddingLatencyMs: cacheLookupMs } : undefined,
        );
        collectAuditDocuments(rawRetrieval);
        const secured = secureRetrievedEvidence(rawRetrieval, env.CHAT_PII_REDACTION_ENABLED);
        retrieval = secured.result;
        injectionPassagesBlocked += secured.blockedPassages;
        piiValuesRedacted += secured.redactedValues;
        securityNotice = securityNoticeFor(injectionPassagesBlocked, piiValuesRedacted);
      }
    }
    citations = retrieval?.citations ?? citations;
    retrievalDebug = retrieval?.debug ?? retrievalDebug;
    const isLowConfidence = !cachedAnswer && retrieval?.citations.length === 0;
    const modelMessages: ModelMessage[] = priorMessages.slice(-20).map((message) => {
      if (!env.CHAT_PII_REDACTION_ENABLED) return { role: message.role, content: message.content };
      const redacted = redactPii(message.content);
      piiValuesRedacted += redacted.count;
      return { role: message.role, content: redacted.text };
    });
    securityNotice = securityNoticeFor(injectionPassagesBlocked, piiValuesRedacted);
    const responseMessageId = randomUUID();
    let finalObservability: ChatObservability | undefined;
    const stream = createUIMessageStream<
      UIMessage<
        unknown,
        {
          citations: ChatCitation[];
          'retrieval-debug': RetrievalDebugChunk[];
          observability: ChatObservability;
          'agent-step': AgentStep;
          'security-notice': SecurityNotice;
        }
      >
    >({
      execute: async ({ writer }) => {
        writer.write({ type: 'start', messageId: responseMessageId });
        if (securityNotice) writer.write({ type: 'data-security-notice', data: securityNotice });
        if (parsed.data.mode === 'simple') {
          writer.write({ type: 'data-citations', data: citations });
          writer.write({ type: 'data-retrieval-debug', data: retrieval?.debug ?? [] });
        }
        let observability: ChatObservability;
        if (cachedAnswer && retrieval && parsed.data.mode === 'simple') {
          const traceId = activeTraceId();
          observability = {
            ...(traceId ? { traceId } : {}),
            modelId: selectedModel.modelId,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            cacheHit: true,
            cacheSimilarity: cachedAnswer.similarity,
            latencyMs: {
              retrieval: cacheLookupMs,
              embedding: cacheLookupMs,
              search: 0,
              rerank: 0,
              generation: 0,
              total: performance.now() - requestStartedAt,
            },
          };
          finalObservability = observability;
          writer.write({ type: 'data-observability', data: observability });
          writer.write({ type: 'text-start', id: responseMessageId });
          writer.write({ type: 'text-delta', id: responseMessageId, delta: cachedAnswer.answer });
          writer.write({ type: 'text-end', id: responseMessageId });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return;
        }
        if (parsed.data.mode === 'agentic') {
          const agentStartedAt = performance.now();
          const agenticRetrieval = createAgenticRetrievalService();
          const result = await createAgenticRagService({
            retrieve: async (query, orgId, tokens) => {
              const raw = await agenticRetrieval.retrieve(query, orgId, tokens);
              collectAuditDocuments(raw);
              const secured = secureRetrievedEvidence(raw, env.CHAT_PII_REDACTION_ENABLED);
              injectionPassagesBlocked += secured.blockedPassages;
              piiValuesRedacted += secured.redactedValues;
              return secured.result;
            },
            maxIterations: env.CHAT_AGENT_MAX_ITERATIONS,
            maxCostUsd: env.CHAT_AGENT_MAX_COST_USD,
            modelId: selectedModel.modelId,
            inputUsdPerMillion: selectedModel.inputUsdPerMillion,
            outputUsdPerMillion: selectedModel.outputUsdPerMillion,
            emit: (step) => writer.write({ type: 'data-agent-step', data: step }),
          }).run({
            question: safeQuestion,
            organizationId,
            aclTokens,
          });
          citations = result.citations;
          retrievalDebug = result.debug;
          securityNotice = securityNoticeFor(injectionPassagesBlocked, piiValuesRedacted);
          const securedAnswer = secureAssistantAnswer(
            result.answer || LOW_CONFIDENCE_ANSWER,
            env.CHAT_PII_REDACTION_ENABLED,
          );
          if (securedAnswer.notice) {
            piiValuesRedacted += 1;
            securityNotice = securityNoticeFor(injectionPassagesBlocked, piiValuesRedacted);
          }
          if (securityNotice) writer.write({ type: 'data-security-notice', data: securityNotice });
          writer.write({ type: 'data-citations', data: citations });
          writer.write({ type: 'data-retrieval-debug', data: retrievalDebug });
          const answer = securedAnswer.answer;
          const agentElapsed = performance.now() - agentStartedAt;
          const traceId = activeTraceId();
          observability = {
            ...(traceId ? { traceId } : {}),
            modelId: selectedModel.modelId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.inputTokens + result.outputTokens,
            estimatedCostUsd: result.estimatedCostUsd,
            latencyMs: {
              retrieval: result.retrieval.total,
              embedding: result.retrieval.embedding,
              search: result.retrieval.search,
              rerank: result.retrieval.rerank,
              generation: Math.max(0, agentElapsed - result.retrieval.total),
              total: performance.now() - requestStartedAt,
            },
          };
          finalObservability = observability;
          writer.write({ type: 'data-observability', data: observability });
          writer.write({ type: 'text-start', id: responseMessageId });
          writer.write({ type: 'text-delta', id: responseMessageId, delta: answer });
          writer.write({ type: 'text-end', id: responseMessageId });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return;
        }
        if (isLowConfidence) {
          const traceId = activeTraceId();
          observability = {
            ...(traceId ? { traceId } : {}),
            modelId: selectedModel.modelId,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            latencyMs: {
              retrieval: retrieval!.latencyMs.total,
              embedding: retrieval!.latencyMs.embedding,
              search: retrieval!.latencyMs.search,
              rerank: retrieval!.latencyMs.rerank,
              generation: 0,
              total: performance.now() - requestStartedAt,
            },
          };
          finalObservability = observability;
          writer.write({ type: 'data-observability', data: observability });
          writer.write({ type: 'text-start', id: responseMessageId });
          writer.write({ type: 'text-delta', id: responseMessageId, delta: LOW_CONFIDENCE_ANSWER });
          writer.write({ type: 'text-end', id: responseMessageId });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return;
        }
        const generationStartedAt = performance.now();
        let outputPiiRedacted = false;
        observability = await withSpan(
          'chat.generation',
          async () => {
            const result = streamText({
              model: chatModelProvider.getModel(selectedModel.modelId),
              system: `${buildGroundedSystemPrompt(citations)}\n\nRetrieved passages:\n${retrieval!.context}`,
              messages: modelMessages,
              maxOutputTokens: 900,
              ...(env.CHAT_PII_REDACTION_ENABLED
                ? {
                    experimental_transform: createPiiRedactionTransform(() => {
                      outputPiiRedacted = true;
                    }),
                  }
                : {}),
              onError: ({ error }) => logger.error({ err: error }, 'Chat model stream failed'),
            });
            writer.merge(
              result.toUIMessageStream({
                sendStart: false,
                onError: () =>
                  `The configured model (${selectedModel.modelId}) could not generate an answer. Check that the configured provider and model are available.`,
              }),
            );
            const usage = await result.totalUsage;
            if (outputPiiRedacted) {
              piiValuesRedacted += 1;
              securityNotice = {
                kind: 'redacted',
                message: 'Sensitive-looking details were masked from this answer.',
              };
              writer.write({ type: 'data-security-notice', data: securityNotice });
            }
            const inputTokens = usage.inputTokens ?? 0;
            const outputTokens = usage.outputTokens ?? 0;
            const generation = performance.now() - generationStartedAt;
            const estimatedCostUsd = estimateTokenCostUsd(
              inputTokens,
              outputTokens,
              selectedModel.inputUsdPerMillion,
              selectedModel.outputUsdPerMillion,
            );
            const traceId = activeTraceId();
            const value: ChatObservability = {
              ...(traceId ? { traceId } : {}),
              modelId: selectedModel.modelId,
              inputTokens,
              outputTokens,
              totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
              estimatedCostUsd,
              latencyMs: {
                retrieval: retrieval!.latencyMs.total,
                embedding: retrieval!.latencyMs.embedding,
                search: retrieval!.latencyMs.search,
                rerank: retrieval!.latencyMs.rerank,
                generation,
                total: performance.now() - requestStartedAt,
              },
            };
            return value;
          },
          { 'gen_ai.request.model': selectedModel.modelId },
        );
        finalObservability = observability;
        writer.write({ type: 'data-observability', data: observability });
      },
      onError: (error) => {
        logger.error({ err: error, conversationId: conversation._id }, 'Chat stream failed');
        return 'Unable to complete the answer. Please try again.';
      },
      onFinish: async ({ responseMessage }) => {
        try {
          const content = responseMessage.parts
            .filter((part) => part.type === 'text')
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('');
          const usedCitations = citationsReferencedInAnswer(content, citations);
          const auditOutcome = !content
            ? 'failed'
            : securityNotice?.kind === 'blocked'
              ? 'blocked'
              : securityNotice
                ? 'redacted'
                : 'answered';
          const writes: Promise<unknown>[] = [
            auditLogsRepository.record({
              organizationId,
              actorUserId: userId,
              actorName: requester.name,
              actorEmail: requester.email,
              outcome: auditOutcome,
              question: safeQuestion,
              lowConfidence: isLowConfidenceAnswer({
                retrievalHadNoCitations: isLowConfidence,
                usedCitationCount: usedCitations.length,
                answer: content,
              }),
              documentIds: [...auditDocuments.keys()],
              documentNames: [...auditDocuments.values()],
            }),
          ];
          if (content) {
            writes.push(
              chatRepository.addMessage({
                organizationId,
                conversationId: conversation._id,
                userId,
                messageId: responseMessageId,
                role: 'assistant',
                content,
                citations: usedCitations,
                retrievalDebug,
                ...(finalObservability ? { observability: finalObservability } : {}),
                ...(securityNotice ? { securityNotice } : {}),
              }),
            );
          }
          const writeResults = await Promise.allSettled(writes);
          if (
            content &&
            usedCitations.length > 0 &&
            cacheScope &&
            cacheVector &&
            parsed.data.mode === 'simple' &&
            finalObservability?.cacheHit !== true &&
            securityNotice?.kind !== 'blocked'
          ) {
            await semanticChatCache.store(cacheScope, cacheVector, {
              answer: content,
              citations: usedCitations,
              retrievalDebug,
              ...(securityNotice ? { securityNotice } : {}),
            });
          }
          for (const result of writeResults) {
            if (result.status === 'rejected') {
              logger.error(
                { err: result.reason, conversationId: conversation._id },
                'Could not persist chat security or message records.',
              );
            }
          }
        } catch (error) {
          logger.error(
            { err: error, conversationId: conversation._id },
            'Could not persist the streamed assistant answer.',
          );
        }
      },
    });
    if (conversation.title === 'New conversation') {
      const title =
        safeQuestion
          .split(/[.!?\n]/, 1)[0]
          ?.trim()
          .slice(0, 58) || 'New conversation';
      await chatRepository.renameConversation(conversation._id, organizationId, userId, title);
    }
    await pipeUIMessageStreamToResponse({ response: res, stream });
  });
};
