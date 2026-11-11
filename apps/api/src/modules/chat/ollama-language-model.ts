import type { LanguageModel } from 'ai';

type OllamaLanguageModel = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type OllamaCallOptions = Parameters<OllamaLanguageModel['doGenerate']>[0];
type OllamaPrompt = OllamaCallOptions['prompt'];
type OllamaFinishReason = Awaited<ReturnType<OllamaLanguageModel['doGenerate']>>['finishReason'];
type OllamaStreamPart =
  Awaited<ReturnType<OllamaLanguageModel['doStream']>>['stream'] extends ReadableStream<infer Part>
    ? Part
    : never;

type OllamaUsage = { prompt_tokens?: number; completion_tokens?: number };

function usage(value?: OllamaUsage) {
  const input = value?.prompt_tokens;
  const output = value?.completion_tokens;
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
    ...(value ? { raw: { prompt_tokens: input ?? null, completion_tokens: output ?? null } } : {}),
  };
}

function finishReason(reason?: string): OllamaFinishReason {
  const unified = reason === 'length' ? 'length' : reason === 'stop' ? 'stop' : 'other';
  return { unified, raw: reason };
}

function toMessages(prompt: OllamaPrompt) {
  return prompt.map((message) => {
    if (message.role === 'system') return { role: 'system', content: message.content };
    const parts = message.content;
    if (parts.some((part) => part.type !== 'text')) {
      throw new Error('Ollama chat currently supports text-only prompts.');
    }
    if (message.role === 'tool') {
      throw new Error('Ollama chat tool messages are not supported in this application.');
    }
    return {
      role: message.role,
      content: parts.map((part) => (part.type === 'text' ? part.text : '')).join(''),
    };
  });
}

function requestBody(modelId: string, options: OllamaCallOptions, stream: boolean) {
  if (options.tools?.length)
    throw new Error('Ollama chat tools are not enabled in this application.');
  return {
    model: modelId,
    messages: toMessages(options.prompt),
    stream,
    stream_options: stream ? { include_usage: true } : undefined,
    ...(options.maxOutputTokens === undefined ? {} : { max_tokens: options.maxOutputTokens }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.topP === undefined ? {} : { top_p: options.topP }),
    ...(options.stopSequences?.length ? { stop: options.stopSequences } : {}),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };
}

async function callOllama(
  baseURL: string,
  modelId: string,
  options: OllamaCallOptions,
  stream: boolean,
  fetchImpl: typeof fetch,
) {
  const url = `${baseURL.replace(/\/$/, '')}/v1/chat/completions`;
  const body = requestBody(modelId, options, stream);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ollama', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(options.abortSignal ? { signal: options.abortSignal } : {}),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Ollama chat failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return { response, url, body };
}

export function createOllamaLanguageModel(
  baseURL: string,
  modelId: string,
  fetchImpl: typeof fetch = fetch,
): OllamaLanguageModel {
  return {
    specificationVersion: 'v4',
    provider: 'ollama',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const { response, url, body } = await callOllama(baseURL, modelId, options, false, fetchImpl);
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object')
        throw new Error('Ollama returned an invalid chat response.');
      const row = result as {
        id?: string;
        created?: number;
        model?: string;
        choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
        usage?: OllamaUsage;
      };
      const text = row.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('Ollama returned an empty chat response.');
      return {
        content: [{ type: 'text', text }],
        finishReason: finishReason(row.choices?.[0]?.finish_reason),
        usage: usage(row.usage),
        warnings: [],
        request: { url, body },
        response: {
          ...(row.id ? { id: row.id } : {}),
          ...(row.model ? { modelId: row.model } : {}),
          ...(row.created ? { timestamp: new Date(row.created * 1000) } : {}),
          headers: Object.fromEntries(response.headers.entries()),
          body: result,
        },
      };
    },
    async doStream(options) {
      const { response, url, body } = await callOllama(baseURL, modelId, options, true, fetchImpl);
      if (!response.body) throw new Error('Ollama did not return a streaming response body.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const textId = 'ollama-text';
      const stream = new ReadableStream<OllamaStreamPart>({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: textId });
          let buffer = '';
          let finalUsage: OllamaUsage | undefined;
          let reason: string | undefined;
          let responseId: string | undefined;
          let responseModel: string | undefined;
          try {
            while (true) {
              const { done, value } = await reader.read();
              buffer += decoder.decode(value, { stream: !done });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                const chunk: unknown = JSON.parse(data);
                if (!chunk || typeof chunk !== 'object') continue;
                const row = chunk as {
                  id?: string;
                  model?: string;
                  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string }>;
                  usage?: OllamaUsage;
                };
                responseId ??= row.id;
                responseModel ??= row.model;
                finalUsage = row.usage ?? finalUsage;
                const choice = row.choices?.[0];
                reason = choice?.finish_reason ?? reason;
                if (typeof choice?.delta?.content === 'string' && choice.delta.content.length) {
                  controller.enqueue({
                    type: 'text-delta',
                    id: textId,
                    delta: choice.delta.content,
                  });
                }
              }
              if (done) break;
            }
            if (buffer.trim().startsWith('data:')) {
              const data = buffer.trim().slice(5).trim();
              if (data && data !== '[DONE]') {
                const row = JSON.parse(data) as {
                  id?: string;
                  model?: string;
                  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string }>;
                  usage?: OllamaUsage;
                };
                responseId ??= row.id;
                responseModel ??= row.model;
                finalUsage = row.usage ?? finalUsage;
                reason = row.choices?.[0]?.finish_reason ?? reason;
                const delta = row.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta.length) {
                  controller.enqueue({ type: 'text-delta', id: textId, delta });
                }
              }
            }
            if (responseId || responseModel) {
              controller.enqueue({
                type: 'response-metadata',
                ...(responseId ? { id: responseId } : {}),
                ...(responseModel ? { modelId: responseModel } : {}),
              });
            }
            controller.enqueue({ type: 'text-end', id: textId });
            controller.enqueue({
              type: 'finish',
              finishReason: finishReason(reason),
              usage: usage(finalUsage),
            });
            controller.close();
          } catch (error) {
            controller.enqueue({ type: 'error', error });
            controller.error(error);
          } finally {
            await reader.cancel().catch(() => undefined);
          }
        },
        cancel() {
          return reader.cancel();
        },
      });
      return {
        stream,
        request: { url, body },
        response: {
          headers: Object.fromEntries(response.headers.entries()),
        },
      };
    },
  };
}
