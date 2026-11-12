import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ insertOne: vi.fn(), updateOne: vi.fn() }));
vi.mock('../src/lib/connections.js', () => ({
  mongoClient: {},
  getDatabase: () => ({
    collection: (name: string) =>
      name === 'messages' ? { insertOne: mocks.insertOne } : { updateOne: mocks.updateOne },
  }),
}));

import { chatRepository } from '../src/modules/chat/chat.repository.js';

describe('chat message persistence IDs', () => {
  it('persists the server streamed assistant message ID for later feedback requests', async () => {
    const messageId = 'd42d58a4-6179-4e6f-99e1-51aa0691fe96';
    mocks.insertOne.mockResolvedValue({ acknowledged: true });
    mocks.updateOne.mockResolvedValue({ acknowledged: true });

    const saved = await chatRepository.addMessage({
      organizationId: 'org-1',
      conversationId: 'fd1d1d6e-d501-4a9c-b6bf-c2ff07468a7c',
      userId: 'user-1',
      messageId,
      role: 'assistant',
      content: 'This is the answer.',
      citations: [],
    });

    expect(saved._id).toBe(messageId);
    expect(mocks.insertOne).toHaveBeenCalledWith(expect.objectContaining({ _id: messageId }));
  });
});
