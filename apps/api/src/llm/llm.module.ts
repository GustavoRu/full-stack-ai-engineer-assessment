import { GoogleGenAI } from '@google/genai';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { GEMINI_HTTP_OPTIONS, GeminiChatModel, GeminiEmbeddingModel } from './gemini.adapter.js';
import { CHAT_MODEL, type ChatModel, EMBEDDING_MODEL, type EmbeddingModel } from './llm.ports.js';
import { MockChatModel, MockEmbeddingModel } from './mock.adapter.js';

const LLM_MODELS = Symbol('LLM_MODELS');
type LlmModels = { chat: ChatModel; embedding: EmbeddingModel };

// The only place that knows which provider is active. A new provider is one case here
function createModels(config: ConfigService<Env, true>): LlmModels {
  switch (config.get('LLM_PROVIDER', { infer: true })) {
    case 'mock':
      return { chat: new MockChatModel(), embedding: new MockEmbeddingModel() };
    case 'gemini': {
      const client = new GoogleGenAI({
        apiKey: config.get('GEMINI_API_KEY', { infer: true }),
        httpOptions: GEMINI_HTTP_OPTIONS,
      });
      return {
        chat: new GeminiChatModel(client, config.get('GEMINI_CHAT_MODEL', { infer: true })),
        embedding: new GeminiEmbeddingModel(client, config.get('GEMINI_EMBEDDING_MODEL', { infer: true })),
      };
    }
  }
}

@Global()
@Module({
  providers: [
    { provide: LLM_MODELS, inject: [ConfigService], useFactory: createModels },
    { provide: CHAT_MODEL, inject: [LLM_MODELS], useFactory: (models: LlmModels) => models.chat },
    { provide: EMBEDDING_MODEL, inject: [LLM_MODELS], useFactory: (models: LlmModels) => models.embedding },
  ],
  exports: [CHAT_MODEL, EMBEDDING_MODEL],
})
export class LlmModule {}
