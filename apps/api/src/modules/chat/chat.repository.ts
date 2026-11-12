import { randomUUID } from 'node:crypto';
import type { Collection, Document } from 'mongodb';
import {
  ChatMessageRecordSchema,
  ConversationRecordSchema,
  type ChatMessageRecord,
  type ConversationRecord,
} from '@orgmind/shared';
import { mongoClient, getDatabase } from '../../lib/connections.js';

type ConversationRow = ConversationRecord & Document;
type MessageRow = ChatMessageRecord & Document;

function conversations(): Collection<ConversationRow> {
  return getDatabase().collection<ConversationRow>('conversations');
}

function messages(): Collection<MessageRow> {
  return getDatabase().collection<MessageRow>('messages');
}

function parseConversation(value: unknown): ConversationRecord {
  return ConversationRecordSchema.parse(value);
}

function parseMessage(value: unknown): ChatMessageRecord {
  return ChatMessageRecordSchema.parse(value);
}

export const chatRepository = {
  async ensureUsageIndex(): Promise<void> {
    await messages().createIndex(
      { organizationId: 1, role: 1, createdAt: -1 },
      { name: 'messages_usage_by_workspace_date' },
    );
  },

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      conversations().createIndex(
        { organizationId: 1, userId: 1, updatedAt: -1 },
        { name: 'conversations_user_recent' },
      ),
      messages().createIndex(
        { conversationId: 1, createdAt: 1 },
        { name: 'messages_conversation_chronological' },
      ),
    ]);
  },

  async createConversation(organizationId: string, userId: string): Promise<ConversationRecord> {
    const now = new Date();
    const record = parseConversation({
      _id: randomUUID(),
      organizationId,
      userId,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
    }) as ConversationRow;
    await conversations().insertOne(record);
    return record;
  },

  async listConversations(organizationId: string, userId: string): Promise<ConversationRecord[]> {
    const rows = await conversations()
      .find({ organizationId, userId })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    return rows.map(parseConversation);
  },

  async findConversation(
    id: string,
    organizationId: string,
    userId: string,
  ): Promise<ConversationRecord | null> {
    const row = await conversations().findOne({ _id: id, organizationId, userId });
    return row ? parseConversation(row) : null;
  },

  async renameConversation(
    id: string,
    organizationId: string,
    userId: string,
    title: string,
  ): Promise<ConversationRecord | null> {
    const row = await conversations().findOneAndUpdate(
      { _id: id, organizationId, userId },
      { $set: { title, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return row ? parseConversation(row) : null;
  },

  async deleteConversation(id: string, organizationId: string, userId: string): Promise<boolean> {
    const session = mongoClient.startSession();
    let deleted = false;
    try {
      await session.withTransaction(async () => {
        const result = await conversations().deleteOne(
          { _id: id, organizationId, userId },
          { session },
        );
        deleted = result.deletedCount === 1;
        if (deleted) await messages().deleteMany({ conversationId: id }, { session });
      });
      return deleted;
    } finally {
      await session.endSession();
    }
  },

  async addMessage(
    record: Omit<ChatMessageRecord, '_id' | 'createdAt' | 'retrievalDebug'> & {
      messageId?: string;
      retrievalDebug?: ChatMessageRecord['retrievalDebug'];
      observability?: ChatMessageRecord['observability'];
      securityNotice?: ChatMessageRecord['securityNotice'];
    },
  ): Promise<ChatMessageRecord> {
    const message = parseMessage({
      ...record,
      _id: record.messageId ?? randomUUID(),
      createdAt: new Date(),
    }) as MessageRow;
    await messages().insertOne(message);
    await conversations().updateOne(
      {
        _id: message.conversationId,
        organizationId: message.organizationId,
        userId: message.userId,
      },
      { $set: { updatedAt: message.createdAt } },
    );
    return message;
  },

  async listMessages(conversationId: string): Promise<ChatMessageRecord[]> {
    const rows = await messages()
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(200)
      .toArray();
    return rows.map(parseMessage);
  },
};
