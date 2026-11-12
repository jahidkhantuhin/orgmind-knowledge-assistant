import type { RequestHandler } from 'express';
import {
  ChatMessageRecordSchema,
  SubmitChatFeedbackSchema,
  WorkspaceAnalyticsResponseSchema,
} from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';
import { feedbackRepository } from './feedback.repository.js';

export const submitChatFeedbackController: RequestHandler = async (req, res) => {
  const organizationId = String(req.params.organizationId ?? '');
  const messageId = String(req.params.messageId ?? '');
  const userId = req.authSession?.user.id;
  if (!organizationId || !messageId || !userId) {
    res.status(400).json({
      error: { code: 'INVALID_FEEDBACK', message: 'Workspace, message, and user are required.' },
    });
    return;
  }
  const parsed = SubmitChatFeedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_FEEDBACK', message: 'Feedback is invalid.' } });
    return;
  }
  const message = await getDatabase()
    .collection<
      {
        _id: string;
        organizationId: string;
        role: string;
        conversationId: string;
        createdAt: Date;
      } & Record<string, unknown>
    >('messages')
    .findOne({ _id: messageId, organizationId, role: 'assistant' });
  if (!message) {
    res
      .status(404)
      .json({ error: { code: 'MESSAGE_NOT_FOUND', message: 'Assistant message was not found.' } });
    return;
  }
  const answer = ChatMessageRecordSchema.parse(message);
  const conversation = await getDatabase()
    .collection<
      { _id: string; organizationId: string; userId: string } & Record<string, unknown>
    >('conversations')
    .findOne({ _id: answer.conversationId, organizationId, userId });
  if (!conversation) {
    res
      .status(404)
      .json({ error: { code: 'MESSAGE_NOT_FOUND', message: 'Conversation was not found.' } });
    return;
  }
  const prior = await getDatabase()
    .collection('messages')
    .findOne(
      {
        conversationId: answer.conversationId,
        organizationId,
        role: 'user',
        createdAt: { $lte: answer.createdAt },
      },
      { sort: { createdAt: -1 } },
    );
  const question = typeof prior?.content === 'string' ? prior.content : '';
  const feedback = await feedbackRepository.upsert({
    organizationId,
    conversationId: answer.conversationId,
    messageId,
    userId,
    vote: parsed.data.vote,
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    question,
    answer: answer.content,
    retrievalTrace: answer.retrievalDebug,
    citationDocumentIds: answer.citations.map((citation) => citation.documentId),
  });
  res.json({ vote: feedback.vote, ...(feedback.reason ? { reason: feedback.reason } : {}) });
};

export const getChatFeedbackController: RequestHandler = async (req, res) => {
  const organizationId = String(req.params.organizationId ?? '');
  const messageId = String(req.params.messageId ?? '');
  const userId = req.authSession?.user.id;
  const feedback =
    organizationId && messageId && userId
      ? await feedbackRepository.get(organizationId, messageId, userId)
      : null;
  res.json({
    vote: feedback?.vote ?? null,
    ...(feedback?.reason ? { reason: feedback.reason } : {}),
  });
};

export const getWorkspaceAnalyticsController: RequestHandler = async (req, res) => {
  const organizationId = String(req.params.organizationId ?? '');
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  since.setUTCHours(0, 0, 0, 0);
  const analytics = await feedbackRepository.summarize(organizationId, since);
  res.json(
    WorkspaceAnalyticsResponseSchema.parse({
      analytics: { since: since.toISOString(), ...analytics },
    }),
  );
};

export const exportFeedbackEvalDatasetController: RequestHandler = async (req, res) => {
  const organizationId = String(req.params.organizationId ?? '');
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const records = await feedbackRepository.exportToEvalDataset(organizationId, since);
  const cases = records.map((record) => ({
    id: record._id,
    question: record.question,
    expectedAnswer: record.answer,
    expectedSourceKeys: record.citationDocumentIds,
    feedbackReason: record.reason,
  }));
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="orgmind-feedback-eval-dataset.json"');
  res.json({ exportedAt: new Date().toISOString(), organizationId, cases });
};
