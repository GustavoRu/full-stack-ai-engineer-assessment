import type { ConfigService } from '@nestjs/config';
import { type Env, validateEnv } from '../config/env.js';
import { GeminiEmbeddingModel } from './gemini.adapter.js';
import { LangChainChatModel } from './langchain-chat.adapter.js';
import { createModels } from './llm.module.js';
import { MockChatModel, MockEmbeddingModel } from './mock.adapter.js';
import { OpenAiEmbeddingModel } from './openai-embedding.adapter.js';

const base = { JWT_SECRET: 'x'.repeat(32) };

function modelsFor(raw: Record<string, string>) {
  const env = validateEnv({ ...base, ...raw });
  const config = { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
  return createModels(config);
}

describe('createModels', () => {
  it('builds the offline models', () => {
    const { chat, embedding } = modelsFor({ LLM_PROVIDER: 'mock' });
    expect(chat).toBeInstanceOf(MockChatModel);
    expect(embedding).toBeInstanceOf(MockEmbeddingModel);
  });

  it('builds Gemini chat through LangChain and Gemini embeddings through the native client', () => {
    const { chat, embedding } = modelsFor({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'key' });
    expect(chat).toBeInstanceOf(LangChainChatModel);
    expect(chat).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
    expect(embedding).toBeInstanceOf(GeminiEmbeddingModel);
    expect(embedding.model).toBe('gemini-embedding-001');
  });

  it('builds OpenAI for chat and embeddings', () => {
    const { chat, embedding } = modelsFor({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
    expect(chat).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(embedding).toBeInstanceOf(OpenAiEmbeddingModel);
    expect(embedding.model).toBe('text-embedding-3-small');
  });

  it('builds Anthropic chat with the embeddings of another provider', () => {
    const { chat, embedding } = modelsFor({
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      EMBEDDING_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
    });
    expect(chat).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(embedding).toBeInstanceOf(GeminiEmbeddingModel);
  });

  it('takes the model names from the settings', () => {
    const { chat, embedding } = modelsFor({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_CHAT_MODEL: 'my-chat',
      OPENAI_EMBEDDING_MODEL: 'my-embedding',
    });
    expect(chat.model).toBe('my-chat');
    expect(embedding.model).toBe('my-embedding');
  });
});
