import { describe, expect, it, vi } from 'vitest';
import { createOllamaLanguageModel } from '../src/modules/chat/ollama-language-model.js';

describe('Ollama language model adapter', () => {
  it('sends generated prompts to Ollama and reports token usage', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-local',
            model: 'qwen3:4b',
            choices: [{ message: { content: 'Grounded answer.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 12, completion_tokens: 5 },
          }),
          { status: 200 },
        ),
    );
    const model = createOllamaLanguageModel('http://localhost:11434/', 'qwen3:4b', fetchImpl);
    const result = await model.doGenerate({
      prompt: [
        { role: 'system', content: 'Use the supplied evidence.' },
        { role: 'user', content: [{ type: 'text', text: 'What is the policy?' }] },
      ],
    } as Parameters<typeof model.doGenerate>[0]);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"stream":false'),
      }),
    );
    expect(result.content).toEqual([{ type: 'text', text: 'Grounded answer.' }]);
    expect(result.usage.inputTokens.total).toBe(12);
    expect(result.usage.outputTokens.total).toBe(5);
  });

  it('converts Ollama SSE deltas into AI SDK text events', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"Local "}}]}\n\ndata: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
                ),
              );
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );
    const model = createOllamaLanguageModel('http://localhost:11434', 'qwen3:4b', fetchImpl);
    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello.' }] }],
    } as Parameters<typeof model.doStream>[0]);
    const events: unknown[] = [];
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
    const eventText = JSON.stringify(events);

    expect(eventText).toContain('Local ');
    expect(eventText).toContain('answer');
    expect(eventText).toContain('"total":4');
  });
});
