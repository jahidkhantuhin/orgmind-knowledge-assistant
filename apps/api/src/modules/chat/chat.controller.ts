import { randomUUID } from 'node:crypto';
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
import { retrievalService } from './retrieval.service.js';
import { LOW_CONFIDENCE_ANSWER, buildGroundedSystemPrompt } from './prompt.builder.js';
import { aclTokensForPrincipal } from '../documents/document-acl.js';
import { documentsRepository } from '../documents/documents.repository.js';

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

  if (!env.GOOGLE_API_KEY) {
    res.status(503).json({
      error: {
        code: 'CHAT_NOT_CONFIGURED',
        message: 'Set GOOGLE_API_KEY before starting a chat.',
      },
    });
    return;
  }
  await chatRepository.addMessage({
    organizationId,
    conversationId: conversation._id,
    userId,
    role: 'user',
    content: question,
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
  const retrieval = await retrievalService.retrieve(question, organizationId, aclTokens);
  const isLowConfidence = retrieval.citations.length === 0;
  const citations = retrieval.citations;
  const modelMessages: ModelMessage[] = priorMessages.slice(-20).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const responseMessageId = randomUUID();
  const stream = createUIMessageStream<
    UIMessage<unknown, { citations: ChatCitation[]; 'retrieval-debug': RetrievalDebugChunk[] }>
  >({
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageId: responseMessageId });
      writer.write({ type: 'data-citations', data: citations });
      writer.write({ type: 'data-retrieval-debug', data: retrieval.debug });
      if (isLowConfidence) {
        writer.write({ type: 'text-start', id: responseMessageId });
        writer.write({ type: 'text-delta', id: responseMessageId, delta: LOW_CONFIDENCE_ANSWER });
        writer.write({ type: 'text-end', id: responseMessageId });
        writer.write({ type: 'finish', finishReason: 'stop' });
        return;
      }
      const result = streamText({
        model: chatModelProvider.getModel(),
        system: `${buildGroundedSystemPrompt(citations)}\n\nRetrieved passages:\n${retrieval.context}`,
        messages: modelMessages,
        maxOutputTokens: 900,
        onError: ({ error }) => logger.error({ err: error }, 'Chat model stream failed'),
      });
      writer.merge(
        result.toUIMessageStream({
          sendStart: false,
          onError: () =>
            `The configured model (${env.CHAT_MODEL}) could not generate an answer. Check that the model is available to your Google AI project and that its quota is available.`,
        }),
      );
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
        if (!content) return;
        const usedCitations = citationsReferencedInAnswer(content, citations);
        await chatRepository.addMessage({
          organizationId,
          conversationId: conversation._id,
          userId,
          role: 'assistant',
          content,
          citations: usedCitations,
          retrievalDebug: retrieval.debug,
        });
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
      question
        .split(/[.!?\n]/, 1)[0]
        ?.trim()
        .slice(0, 58) || 'New conversation';
    await chatRepository.renameConversation(conversation._id, organizationId, userId, title);
  }
  await pipeUIMessageStreamToResponse({ response: res, stream });
};
