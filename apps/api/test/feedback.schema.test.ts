import { describe, expect, it } from 'vitest';
import {
  SubmitChatFeedbackSchema,
  ChatFeedbackRecordSchema,
  WorkspaceAnalyticsResponseSchema,
} from '@orgmind/shared';

describe('feedback and analytics contracts', () => {
  it('accepts a vote with an optional reason and rejects an oversized reason', () => {
    expect(SubmitChatFeedbackSchema.safeParse({ vote: 'up' }).success).toBe(true);
    expect(
      SubmitChatFeedbackSchema.safeParse({ vote: 'down', reason: 'Could not find the policy.' })
        .success,
    ).toBe(true);
    expect(
      SubmitChatFeedbackSchema.safeParse({ vote: 'down', reason: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('requires workspace, answer, question, and retrieval trace to store feedback', () => {
    const valid = {
      _id: 'd0bc3a76-482d-4594-84d7-14bb93b582a1',
      organizationId: 'org-1',
      conversationId: 'fd1d1d6e-d501-4a9c-b6bf-c2ff07468a7c',
      messageId: 'd42d58a4-6179-4e6f-99e1-51aa0691fe96',
      userId: 'user-1',
      vote: 'down',
      reason: 'Need a clearer source.',
      question: 'What is the policy?',
      answer: 'I do not know.',
      retrievalTrace: [],
      citationDocumentIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(ChatFeedbackRecordSchema.safeParse(valid).success).toBe(true);
    expect(
      ChatFeedbackRecordSchema.safeParse({
        ...valid,
        retrievalTrace: Array.from({ length: 101 }, () => ({})),
      }).success,
    ).toBe(false);
  });

  it('validates dashboard rates and counts', () => {
    expect(
      WorkspaceAnalyticsResponseSchema.safeParse({
        analytics: {
          since: new Date().toISOString(),
          totalQuestions: 2,
          unansweredQuestions: 1,
          lowConfidenceRate: 0.5,
          topQuestions: [{ question: 'How?', count: 2 }],
          knowledgeGaps: [{ question: 'Why?', count: 1 }],
          feedback: { positive: 1, negative: 0 },
        },
      }).success,
    ).toBe(true);
    expect(
      WorkspaceAnalyticsResponseSchema.safeParse({ analytics: { lowConfidenceRate: 1.2 } }).success,
    ).toBe(false);
  });
});
