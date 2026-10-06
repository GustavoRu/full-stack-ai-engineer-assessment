import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

// A blank value in a .env file means "not set"
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

// Empty means "do not send it": models that reason reject a temperature other than their own
const temperature = z.preprocess(
  (value) => (value === undefined ? 0.2 : value === '' ? null : value),
  z.union([z.null(), z.coerce.number().min(0).max(1)]),
);

type Draft = { LLM_PROVIDER: string; EMBEDDING_PROVIDER?: string };
const usesProvider = (env: Draft, provider: string) =>
  env.LLM_PROVIDER === provider || (env.EMBEDDING_PROVIDER ?? env.LLM_PROVIDER) === provider;

const envSchema = z
  .object({
    PORT: positiveInt(3001),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    API_DOCS_ENABLED: flag('true'),
    // Number of reverse proxies in front of the API; 0 means it is reached directly
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

    DB_HOST: z.string().default('localhost'),
    DB_PORT: positiveInt(5432),
    DB_NAME: z.string().default('docqa'),
    DB_USER: z.string().default('docqa'),
    DB_PASSWORD: z.string().default('docqa'),
    DB_SSL: flag('false'),

    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN_SECONDS: positiveInt(3600),

    // A known account created at startup so the app can be tried without registering; local use only
    DEMO_USER_EMAIL: optional(z.email().max(254)),
    DEMO_USER_PASSWORD: optional(z.string().min(8).max(128)),

    LLM_PROVIDER: z.enum(['gemini', 'openai', 'anthropic', 'mock']).default('gemini'),
    // Defaults to the chat provider; required when that is Anthropic, which has no embedding model
    EMBEDDING_PROVIDER: optional(z.enum(['gemini', 'openai', 'mock'])),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_CHAT_MODEL: z.string().default('gemini-3.1-flash-lite'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
    OPENAI_API_KEY: optional(z.string()),
    OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    ANTHROPIC_API_KEY: optional(z.string()),
    ANTHROPIC_CHAT_MODEL: z.string().default('claude-haiku-4-5'),
    LLM_TEMPERATURE: temperature,
    PROMPT_VERSION: z.string().default('qa-v1'),

    MAX_UPLOAD_BYTES: positiveInt(5 * 1024 * 1024),
    MAX_DOCUMENT_CHARS: positiveInt(50_000),
    MAX_QUESTION_CHARS: positiveInt(1_000),
    RETRIEVAL_TOP_K: positiveInt(5),
    MAX_OUTPUT_TOKENS: positiveInt(800),
  })
  .refine((env) => !(env.LLM_PROVIDER === 'anthropic' && !env.EMBEDDING_PROVIDER), {
    message: 'EMBEDDING_PROVIDER is required when LLM_PROVIDER is anthropic, because Anthropic has no embedding model',
    path: ['EMBEDDING_PROVIDER'],
  })
  .refine((env) => !usesProvider(env, 'gemini') || !!env.GEMINI_API_KEY, {
    message: 'GEMINI_API_KEY is required when Gemini is used for chat or embeddings',
    path: ['GEMINI_API_KEY'],
  })
  .refine((env) => !usesProvider(env, 'openai') || !!env.OPENAI_API_KEY, {
    message: 'OPENAI_API_KEY is required when OpenAI is used for chat or embeddings',
    path: ['OPENAI_API_KEY'],
  })
  .refine((env) => env.LLM_PROVIDER !== 'anthropic' || !!env.ANTHROPIC_API_KEY, {
    message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic',
    path: ['ANTHROPIC_API_KEY'],
  })
  .refine((env) => !!env.DEMO_USER_EMAIL === !!env.DEMO_USER_PASSWORD, {
    message: 'DEMO_USER_EMAIL and DEMO_USER_PASSWORD must be set together',
    path: ['DEMO_USER_PASSWORD'],
  })
  // The refinements above guarantee that the embedding provider is known by now
  .transform((env) => ({
    ...env,
    EMBEDDING_PROVIDER: (env.EMBEDDING_PROVIDER ?? env.LLM_PROVIDER) as 'gemini' | 'openai' | 'mock',
  }));

export type Env = z.infer<typeof envSchema>;

// Used by ConfigModule so the app refuses to start with bad configuration
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
