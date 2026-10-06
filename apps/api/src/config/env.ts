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

    LLM_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_CHAT_MODEL: z.string().default('gemini-3.1-flash-lite'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
    PROMPT_VERSION: z.string().default('qa-v1'),

    MAX_UPLOAD_BYTES: positiveInt(5 * 1024 * 1024),
    MAX_DOCUMENT_CHARS: positiveInt(50_000),
    MAX_QUESTION_CHARS: positiveInt(1_000),
    RETRIEVAL_TOP_K: positiveInt(5),
    MAX_OUTPUT_TOKENS: positiveInt(800),
  })
  .refine((env) => env.LLM_PROVIDER !== 'gemini' || !!env.GEMINI_API_KEY, {
    message: 'GEMINI_API_KEY is required when LLM_PROVIDER is gemini',
    path: ['GEMINI_API_KEY'],
  })
  .refine((env) => !!env.DEMO_USER_EMAIL === !!env.DEMO_USER_PASSWORD, {
    message: 'DEMO_USER_EMAIL and DEMO_USER_PASSWORD must be set together',
    path: ['DEMO_USER_PASSWORD'],
  });

export type Env = z.infer<typeof envSchema>;

// Used by ConfigModule so the app refuses to start with bad configuration
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
