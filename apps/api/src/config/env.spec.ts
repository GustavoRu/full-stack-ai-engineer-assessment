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

  it('rejects an unknown provider', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'openai' })).toThrow(/LLM_PROVIDER/);
  });
});
