import { randomUUID } from 'node:crypto';
import type { Document } from 'mongodb';
import { ChatFeedbackRecordSchema, type ChatFeedbackRecord } from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';

type FeedbackRow = ChatFeedbackRecord & Document;
const collection = () => getDatabase().collection<FeedbackRow>('chatFeedback');

export const feedbackRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      collection().createIndex(
        { organizationId: 1, messageId: 1, userId: 1 },
        { unique: true, name: 'feedback_message_user_unique' },
      ),
      collection().createIndex(
        { organizationId: 1, createdAt: -1 },
        { name: 'feedback_workspace_recent' },
      ),
    ]);
  },
  async upsert(
    input: Omit<ChatFeedbackRecord, '_id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ChatFeedbackRecord> {
    const now = new Date();
    const id = randomUUID();
    await collection().updateOne(
      { organizationId: input.organizationId, messageId: input.messageId, userId: input.userId },
      { $set: { ...input, updatedAt: now }, $setOnInsert: { _id: id, createdAt: now } },
      { upsert: true },
    );
    const row = await collection().findOne({
      organizationId: input.organizationId,
      messageId: input.messageId,
      userId: input.userId,
    });
    return ChatFeedbackRecordSchema.parse(row);
  },
  async get(organizationId: string, messageId: string, userId: string) {
    const row = await collection().findOne({ organizationId, messageId, userId });
    return row ? ChatFeedbackRecordSchema.parse(row) : null;
  },
  async summarize(organizationId: string, since: Date) {
    const feedback = await collection()
      .aggregate([
        { $match: { organizationId, createdAt: { $gte: since } } },
        { $group: { _id: '$vote', count: { $sum: 1 } } },
      ])
      .toArray();
    const votes = Object.fromEntries(feedback.map((row) => [row._id, row.count])) as Record<
      string,
      number
    >;
    const audit = getDatabase().collection('auditLogs');
    const baseMatch = { organizationId, createdAt: { $gte: since }, action: 'chat' };
    const unansweredMatch = {
      ...baseMatch,
      $or: [
        { lowConfidence: true },
        { outcome: 'failed' },
        { lowConfidence: { $exists: false }, documentIds: { $size: 0 } },
      ],
    };
    const [totalQuestions, unansweredQuestions, topQuestions, knowledgeGaps] = await Promise.all([
      audit.countDocuments(baseMatch),
      audit.countDocuments(unansweredMatch),
      audit
        .aggregate([
          { $match: baseMatch },
          { $group: { _id: '$question', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ])
        .toArray(),
      audit
        .aggregate([
          { $match: unansweredMatch },
          { $group: { _id: '$question', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ])
        .toArray(),
    ]);
    return {
      totalQuestions,
      unansweredQuestions,
      lowConfidenceRate: totalQuestions ? unansweredQuestions / totalQuestions : 0,
      topQuestions: topQuestions.map((item) => ({
        question: String(item._id),
        count: Number(item.count),
      })),
      knowledgeGaps: knowledgeGaps.map((item) => ({
        question: String(item._id),
        count: Number(item.count),
      })),
      feedback: { positive: Number(votes.up ?? 0), negative: Number(votes.down ?? 0) },
    };
  },
  async exportToEvalDataset(organizationId: string, since: Date) {
    return collection()
      .find({ organizationId, createdAt: { $gte: since }, vote: 'up' })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
  },
};
