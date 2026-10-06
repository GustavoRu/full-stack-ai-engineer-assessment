import { validateEnv } from './env.js';

const base = { JWT_SECRET: 'x'.repeat(32), LLM_PROVIDER: 'mock' };

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3001);
    expect(env.MAX_DOCUMENT_CHARS).toBe(50_000);
    expect(env.RETRIEVAL_TOP_K).toBe(5);
    expect(env.PROMPT_VERSION).toBe('qa-v1');
    expect(env.JWT_EXPIRES_IN_SECONDS).toBe(3600);
  });

  it('coerces numeric strings', () => {
    expect(validateEnv({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('rejects a missing or short JWT secret', () => {
    expect(() => validateEnv({ LLM_PROVIDER: 'mock' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('requires an API key only for the gemini provider', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '' })).toThrow(/GEMINI_API_KEY/);
    expect(validateEnv({ ...base, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'key' }).LLM_PROVIDER).toBe('gemini');
  });

  it('enables the API docs by default and lets them be switched off', () => {
    expect(validateEnv(base).API_DOCS_ENABLED).toBe(true);
    expect(validateEnv({ ...base, API_DOCS_ENABLED: 'false' }).API_DOCS_ENABLED).toBe(false);
    expect(() => validateEnv({ ...base, API_DOCS_ENABLED: 'maybe' })).toThrow(/API_DOCS_ENABLED/);
  });

  it('keeps database TLS and proxy trust off by default and reads them when set', () => {
    const defaults = validateEnv(base);
    expect(defaults.DB_SSL).toBe(false);
    expect(defaults.TRUST_PROXY_HOPS).toBe(0);

    const production = validateEnv({ ...base, DB_SSL: 'true', TRUST_PROXY_HOPS: '1' });
    expect(production.DB_SSL).toBe(true);
    expect(production.TRUST_PROXY_HOPS).toBe(1);

    expect(() => validateEnv({ ...base, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('accepts a demo user only when both values are set and the password is long enough', () => {
    expect(validateEnv(base).DEMO_USER_EMAIL).toBeUndefined();
    expect(validateEnv({ ...base, DEMO_USER_EMAIL: '', DEMO_USER_PASSWORD: '' }).DEMO_USER_EMAIL).toBeUndefined();

    const demo = validateEnv({ ...base, DEMO_USER_EMAIL: 'test@test.com', DEMO_USER_PASSWORD: 'test-password' });
    expect(demo.DEMO_USER_EMAIL).toBe('test@test.com');
    expect(demo.DEMO_USER_PASSWORD).toBe('test-password');

    expect(() => validateEnv({ ...base, DEMO_USER_EMAIL: 'test@test.com' })).toThrow(/DEMO_USER_PASSWORD/);
    expect(() => validateEnv({ ...base, DEMO_USER_PASSWORD: 'test-password' })).toThrow(/DEMO_USER_PASSWORD/);
    expect(() => validateEnv({ ...base, DEMO_USER_EMAIL: 'test@test.com', DEMO_USER_PASSWORD: 'short' })).toThrow(
      /DEMO_USER_PASSWORD/,
    );
  });

  it('lets chat use OpenAI or Anthropic, with the documented default models', () => {
    const openai = validateEnv({ ...base, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
    expect(openai.OPENAI_CHAT_MODEL).toBe('gpt-4o-mini');
    expect(openai.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(openai.EMBEDDING_PROVIDER).toBe('openai');

    const anthropic = validateEnv({
      ...base,
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      EMBEDDING_PROVIDER: 'mock',
    });
    expect(anthropic.ANTHROPIC_CHAT_MODEL).toBe('claude-haiku-4-5');
    expect(anthropic.EMBEDDING_PROVIDER).toBe('mock');
  });

  it('follows the chat provider for embeddings unless told otherwise', () => {
    expect(validateEnv(base).EMBEDDING_PROVIDER).toBe('mock');
    const mixed = validateEnv({
      ...base,
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      EMBEDDING_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
    });
    expect(mixed.EMBEDDING_PROVIDER).toBe('gemini');
  });

  it('requires the key of every provider that is in use, and names the setting', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'anthropic', EMBEDDING_PROVIDER: 'mock' })).toThrow(/ANTHROPIC_API_KEY/);
    // Chat on the mock, embeddings on OpenAI: the embedding provider needs its key too
    expect(() => validateEnv({ ...base, EMBEDDING_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ ...base, EMBEDDING_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
  });

  it('refuses Anthropic without an embedding provider, because Anthropic has no embedding model', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' })).toThrow(
      /EMBEDDING_PROVIDER/,
    );
  });

  it('defaults the temperature to 0.2, reads a number, and treats empty as not sent', () => {
    expect(validateEnv(base).LLM_TEMPERATURE).toBe(0.2);
    expect(validateEnv({ ...base, LLM_TEMPERATURE: '0.5' }).LLM_TEMPERATURE).toBe(0.5);
    expect(validateEnv({ ...base, LLM_TEMPERATURE: '' }).LLM_TEMPERATURE).toBeNull();
    expect(() => validateEnv({ ...base, LLM_TEMPERATURE: '1.5' })).toThrow(/LLM_TEMPERATURE/);
    expect(() => validateEnv({ ...base, LLM_TEMPERATURE: 'hot' })).toThrow(/LLM_TEMPERATURE/);
  });

  it('rejects an unknown provider', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'cohere' })).toThrow(/LLM_PROVIDER/);
    expect(() => validateEnv({ ...base, EMBEDDING_PROVIDER: 'anthropic' })).toThrow(/EMBEDDING_PROVIDER/);
  });
});
