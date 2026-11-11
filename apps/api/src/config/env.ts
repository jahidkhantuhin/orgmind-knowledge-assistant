import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    MONGODB_URI: z
      .string()
      .min(1)
      .default(
        'mongodb://root:orgmind-local@localhost:27017/orgmind?authSource=admin&directConnection=true',
      ),
    MONGODB_DATABASE: z.string().min(1).default('orgmind'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    TEST_MONGODB_DATABASE: z.string().min(1).default('orgmind_test'),
    BETTER_AUTH_URL: z.string().url().default('http://localhost:4000'),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default('orgmind-local-development-secret-change-before-deploying-2026'),
    SEED_ADMIN_NAME: z.string().min(2).default('OrgMind Admin'),
    SEED_ADMIN_EMAIL: z.email().default('admin@orgmind.local'),
    SEED_ADMIN_PASSWORD: z.string().min(12).default('ChangeThisPassword123!'),
    SEED_ORGANIZATION_NAME: z.string().min(2).default('OrgMind'),
    UPLOAD_STORAGE_DIR: z.string().min(1).default('./.data/uploads'),
    MAX_DOCUMENT_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
    MAX_DOCUMENT_TEXT_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(12 * 1024 * 1024)
      .default(3 * 1024 * 1024),
    GOOGLE_API_KEY: z.string().default(''),
    CHAT_PROVIDER: z.enum(['google', 'ollama']).default('google'),
    OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),
    GEMINI_INPUT_COST_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.3),
    GEMINI_OUTPUT_COST_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(2.5),
    CHAT_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
    CHAT_FAST_MODEL: z.string().default(''),
    CHAT_STRONG_MODEL: z.string().min(1).default('gemini-3.8-flash'),
    GEMINI_STRONG_INPUT_COST_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.75),
    GEMINI_STRONG_OUTPUT_COST_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(3.75),
    CHAT_SEMANTIC_CACHE_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    CHAT_SEMANTIC_CACHE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.94),
    CHAT_SEMANTIC_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
    CHAT_SEMANTIC_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(1_000).default(200),
    CHAT_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
    CHAT_MIN_RELEVANCE_SCORE: z.coerce.number().min(0).max(1).default(0.45),
    CHAT_RETRIEVAL_STRATEGY: z.enum(['vector', 'hybrid']).default('hybrid'),
    CHAT_VECTOR_SEARCH_WEIGHT: z.coerce.number().min(0).default(0.7),
    CHAT_KEYWORD_SEARCH_WEIGHT: z.coerce.number().min(0).default(0.3),
    CHAT_RERANK_CANDIDATE_COUNT: z.coerce.number().int().min(1).max(100).default(20),
    CHAT_AGENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(3).default(2),
    CHAT_AGENT_MAX_COST_USD: z.coerce.number().positive().max(1).default(0.05),
    CHAT_PII_REDACTION_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    EVAL_ORGANIZATION_ID: z.string().default(''),
    EVAL_MIN_RECALL_AT_K: z.coerce.number().min(0).max(1).default(0.6),
    EVAL_MAX_RERANK_RECALL_DROP: z.coerce.number().min(0).max(1).default(0.1),
    EVAL_GEMINI_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(7_000),
    COHERE_API_KEY: z.string().default(''),
    COHERE_RERANK_MODEL: z.string().min(1).default('rerank-v5.0-fast'),
    CHAT_QUERY_REWRITE_DEFAULT_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    CONTEXTUAL_ENRICHMENT_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    CONTEXT_ENRICHMENT_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
    CONTEXT_ENRICHMENT_CACHE_TTL_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
    EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
    EMBEDDING_PROVIDER: z.enum(['google', 'ollama']).default('google'),
    EMBEDDING_DIMENSIONS: z.coerce
      .number()
      .int()
      .pipe(z.union([z.literal(768), z.literal(1536), z.literal(3072)]))
      .default(768),
    CHUNK_TARGET_CHARACTERS: z.coerce.number().int().min(200).max(6000).default(1800),
    CHUNK_OVERLAP_CHARACTERS: z.coerce.number().int().min(0).max(2000).default(250),
    MAX_EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(32),
    SEARCH_INDEX_WAIT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(15 * 60_000)
      .default(5 * 60_000),
  })
  .superRefine((value, context) => {
    if (value.CHUNK_OVERLAP_CHARACTERS >= value.CHUNK_TARGET_CHARACTERS) {
      context.addIssue({
        code: 'custom',
        path: ['CHUNK_OVERLAP_CHARACTERS'],
        message: 'CHUNK_OVERLAP_CHARACTERS must be smaller than CHUNK_TARGET_CHARACTERS.',
      });
    }
    if (value.CHAT_VECTOR_SEARCH_WEIGHT + value.CHAT_KEYWORD_SEARCH_WEIGHT <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['CHAT_VECTOR_SEARCH_WEIGHT'],
        message: 'At least one retrieval weight must be greater than zero.',
      });
    }
    if (value.CHAT_RERANK_CANDIDATE_COUNT < value.CHAT_TOP_K) {
      context.addIssue({
        code: 'custom',
        path: ['CHAT_RERANK_CANDIDATE_COUNT'],
        message: 'CHAT_RERANK_CANDIDATE_COUNT must be at least CHAT_TOP_K.',
      });
    }
  });

const parsedEnv = EnvSchema.parse(process.env);
if (
  parsedEnv.NODE_ENV === 'production' &&
  parsedEnv.BETTER_AUTH_SECRET === 'orgmind-local-development-secret-change-before-deploying-2026'
) {
  throw new Error('BETTER_AUTH_SECRET must be set to a unique secret in production.');
}
if (parsedEnv.NODE_ENV === 'production' && parsedEnv.BETTER_AUTH_URL.includes('localhost')) {
  throw new Error('BETTER_AUTH_URL must use the deployed API origin in production.');
}

export const env = parsedEnv;
