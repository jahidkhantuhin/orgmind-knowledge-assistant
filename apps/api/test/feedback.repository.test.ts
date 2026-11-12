import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  feedback: {
    aggregate: vi.fn(),
    updateOne: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    createIndex: vi.fn(),
  },
  audit: { countDocuments: vi.fn(), aggregate: vi.fn() },
}));
vi.mock('../src/lib/connections.js', () => ({
  getDatabase: () => ({
    collection: (name: string) => (name === 'chatFeedback' ? mocks.feedback : mocks.audit),
  }),
}));

import { feedbackRepository } from '../src/modules/chat/feedback.repository.js';

describe('feedback repository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts feedback with its complete trace and returns the stored record', async () => {
    const record = {
      _id: 'd0bc3a76-482d-4594-84d7-14bb93b582a1',
      organizationId: 'org-1',
      conversationId: 'fd1d1d6e-d501-4a9c-b6bf-c2ff07468a7c',
      messageId: 'd42d58a4-6179-4e6f-99e1-51aa0691fe96',
      userId: 'user-1',
      vote: 'down',
      reason: 'Missing source detail.',
      question: 'What is the rule?',
      answer: 'I do not know.',
      retrievalTrace: [],
      citationDocumentIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.feedback.updateOne.mockResolvedValue({ acknowledged: true });
    mocks.feedback.findOne.mockResolvedValue(record);
    const result = await feedbackRepository.upsert({
      organizationId: record.organizationId,
      conversationId: record.conversationId,
      messageId: record.messageId,
      userId: record.userId,
      vote: 'down',
      reason: record.reason,
      question: record.question,
      answer: record.answer,
      retrievalTrace: [],
      citationDocumentIds: [],
    });
    expect(mocks.feedback.updateOne).toHaveBeenCalledWith(
      { organizationId: 'org-1', messageId: record.messageId, userId: 'user-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ retrievalTrace: [], reason: 'Missing source detail.' }),
      }),
      { upsert: true },
    );
    expect(result.question).toBe('What is the rule?');
    expect(result.retrievalTrace).toEqual([]);
  });

  it('aggregates workspace totals and limits the displayed question lists', async () => {
    mocks.feedback.aggregate.mockReturnValue({
      toArray: async () => [
        { _id: 'up', count: 4 },
        { _id: 'down', count: 1 },
      ],
    });
    mocks.audit.countDocuments.mockResolvedValueOnce(10).mockResolvedValueOnce(3);
    mocks.audit.aggregate
      .mockReturnValueOnce({ toArray: async () => [{ _id: 'Question A', count: 5 }] })
      .mockReturnValueOnce({ toArray: async () => [{ _id: 'Question B', count: 3 }] });
    const summary = await feedbackRepository.summarize('org-1', new Date('2026-01-01T00:00:00Z'));
    expect(summary).toEqual({
      totalQuestions: 10,
      unansweredQuestions: 3,
      lowConfidenceRate: 0.3,
      topQuestions: [{ question: 'Question A', count: 5 }],
      knowledgeGaps: [{ question: 'Question B', count: 3 }],
      feedback: { positive: 4, negative: 1 },
    });
  });

  it('exports only positive workspace feedback within the date window', async () => {
    const items = [{ _id: 'item-1', vote: 'up' }];
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(items),
    };
    mocks.feedback.find.mockReturnValue(cursor);
    await expect(
      feedbackRepository.exportToEvalDataset('org-1', new Date('2026-01-01T00:00:00Z')),
    ).resolves.toEqual(items);
    expect(mocks.feedback.find).toHaveBeenCalledWith({
      organizationId: 'org-1',
      createdAt: { $gte: expect.any(Date) },
      vote: 'up',
    });
    expect(cursor.limit).toHaveBeenCalledWith(500);
  });
});
