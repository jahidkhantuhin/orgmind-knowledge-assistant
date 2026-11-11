import { env } from '../../config/env.js';

export type EmbeddingTask = 'document' | 'query';

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  readonly profile: string;
  embed(
    _texts: readonly string[],
    _task?: EmbeddingTask,
    _onProgress?: (_completed: number, _total: number) => void | Promise<void>,
  ): Promise<Float32Array[]>;
}

export type EmbedContentParameters = {
  model: string;
  contents: string[];
  config: { taskType: string; outputDimensionality: number };
};

export type EmbedContentClient = {
  models: {
    embedContent(_parameters: EmbedContentParameters): Promise<{
      embeddings?: Array<{ values?: number[] }>;
    }>;
  };
};

type GeminiEmbeddingOptions = {
  apiKey: string;
  model: string;
  dimensions: number;
  batchSize: number;
  maximumAttempts?: number;
  wait?: (_milliseconds: number) => Promise<void>;
  createClient?: (_apiKey: string) => Promise<EmbedContentClient>;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    httpStatus?: unknown;
    code?: unknown;
  };
  const status = Number(value.status ?? value.statusCode ?? value.httpStatus ?? value.code);
  return Number.isFinite(status) ? status : undefined;
}

function isRetryable(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    String((error as { code?: unknown }).code ?? '').toUpperCase() === 'RESOURCE_EXHAUSTED'
  ) {
    return true;
  }
  const status = responseStatus(error);
  return (
    status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599)
  );
}

function isPerMinuteTokenLimit(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /tokens?.{0,20}per minute|per minute.{0,20}tokens?/i.test(error.message);
}

function normalizeEmbedding(values: number[], dimensions: number): Float32Array {
  if (values.length !== dimensions || values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `The embedding provider returned an invalid ${values.length}-dimension vector.`,
    );
  }
  const norm = Math.sqrt(values.reduce((total, value) => total + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error('The embedding provider returned a zero vector.');
  return Float32Array.from(values, (value) => value / norm);
}

async function createDefaultClient(apiKey: string): Promise<EmbedContentClient> {
  const moduleName: string = '@google/genai';
  const sdk = (await import(moduleName)) as {
    GoogleGenAI: new (_options: { apiKey: string }) => EmbedContentClient;
  };
  return new sdk.GoogleGenAI({ apiKey });
}

export function createGeminiEmbeddingProvider(options: GeminiEmbeddingOptions): EmbeddingProvider {
  const wait = options.wait ?? delay;
  const maximumAttempts = options.maximumAttempts ?? 5;
  const clientFactory = options.createClient ?? createDefaultClient;
  let clientPromise: Promise<EmbedContentClient> | undefined;

  async function getClient(): Promise<EmbedContentClient> {
    if (!options.apiKey) throw new Error('Set GOOGLE_API_KEY before embedding documents.');
    clientPromise ??= clientFactory(options.apiKey).catch((error: unknown) => {
      clientPromise = undefined;
      throw error;
    });
    return clientPromise;
  }

  async function embedBatch(texts: string[], task: EmbeddingTask): Promise<Float32Array[]> {
    const client = await getClient();
    let attempt = 0;
    while (true) {
      try {
        const response = await client.models.embedContent({
          model: options.model,
          contents: texts,
          config: {
            taskType: task === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
            outputDimensionality: options.dimensions,
          },
        });
        const embeddings = response.embeddings;
        if (!embeddings || embeddings.length !== texts.length) {
          throw new Error('The embedding provider returned an unexpected number of vectors.');
        }
        return embeddings.map((embedding) => {
          if (!embedding.values)
            throw new Error('The embedding provider returned an empty vector.');
          return normalizeEmbedding(embedding.values, options.dimensions);
        });
      } catch (error) {
        attempt += 1;
        if (!isRetryable(error) || attempt >= maximumAttempts) throw error;
        const exponentialBackoff = Math.min(8_000, 500 * 2 ** (attempt - 1));
        const backoff = isPerMinuteTokenLimit(error)
          ? Math.max(65_000, exponentialBackoff)
          : exponentialBackoff;
        await wait(backoff + Math.round(Math.random() * backoff * 0.2));
      }
    }
  }

  return {
    model: options.model,
    dimensions: options.dimensions,
    profile: `google:${options.model}:${options.dimensions}`,
    async embed(texts, task = 'document', onProgress) {
      if (texts.length === 0) return [];
      if (texts.some((text) => !text.trim()))
        throw new Error('Embedding inputs must not be empty.');
      const vectors: Float32Array[] = [];
      for (let offset = 0; offset < texts.length; offset += options.batchSize) {
        const batch = await embedBatch(texts.slice(offset, offset + options.batchSize), task);
        vectors.push(...batch);
        await onProgress?.(vectors.length, texts.length);
      }
      return vectors;
    },
  };
}

type OllamaEmbeddingOptions = {
  baseURL: string;
  model: string;
  dimensions: number;
  batchSize: number;
  fetchImpl?: typeof fetch;
};

export function createOllamaEmbeddingProvider(options: OllamaEmbeddingOptions): EmbeddingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseURL = options.baseURL.replace(/\/$/, '');
  return {
    model: options.model,
    dimensions: options.dimensions,
    profile: `ollama:${options.model}:${options.dimensions}`,
    async embed(texts, task = 'document', onProgress) {
      if (texts.length === 0) return [];
      if (texts.some((text) => !text.trim()))
        throw new Error('Embedding inputs must not be empty.');
      const vectors: Float32Array[] = [];
      for (let offset = 0; offset < texts.length; offset += options.batchSize) {
        const batch = texts.slice(offset, offset + options.batchSize);
        const input = batch.map((text) =>
          task === 'document' ? `search_document: ${text}` : `search_query: ${text}`,
        );
        const response = await fetchImpl(`${baseURL}/api/embed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: options.model, input }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          throw new Error(
            `Ollama embeddings failed (${response.status}). Ensure the model is pulled.`,
          );
        }
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('embeddings' in body)) {
          throw new Error('Ollama returned an invalid embeddings response.');
        }
        const embeddings = (body as { embeddings?: unknown }).embeddings;
        if (
          !Array.isArray(embeddings) ||
          embeddings.length !== batch.length ||
          embeddings.some(
            (embedding) =>
              !Array.isArray(embedding) ||
              embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value)),
          )
        ) {
          throw new Error('Ollama returned an unexpected number of embeddings.');
        }
        vectors.push(
          ...embeddings.map((embedding) =>
            normalizeEmbedding(embedding as number[], options.dimensions),
          ),
        );
        await onProgress?.(vectors.length, texts.length);
      }
      return vectors;
    },
  };
}

export const embeddingProvider: EmbeddingProvider =
  env.EMBEDDING_PROVIDER === 'ollama'
    ? createOllamaEmbeddingProvider({
        baseURL: env.OLLAMA_BASE_URL,
        model: env.EMBEDDING_MODEL,
        dimensions: env.EMBEDDING_DIMENSIONS,
        batchSize: env.MAX_EMBEDDING_BATCH_SIZE,
      })
    : createGeminiEmbeddingProvider({
        apiKey: env.GOOGLE_API_KEY,
        model: env.EMBEDDING_MODEL,
        dimensions: env.EMBEDDING_DIMENSIONS,
        batchSize: env.MAX_EMBEDDING_BATCH_SIZE,
      });
