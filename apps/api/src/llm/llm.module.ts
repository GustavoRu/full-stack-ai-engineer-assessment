import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { GoogleGenAI } from '@google/genai';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { EMBEDDING_DIMENSIONS } from '../database/schema.js';
import { GEMINI_HTTP_OPTIONS, GeminiEmbeddingModel } from './gemini.adapter.js';
import {
  type ChatModelFactory,
  type ChatModelOptions,
  type LangChainChat,
  LangChainChatModel,
} from './langchain-chat.adapter.js';
import { CHAT_MODEL, type ChatModel, EMBEDDING_MODEL, type EmbeddingModel } from './llm.ports.js';
import { MockChatModel, MockEmbeddingModel } from './mock.adapter.js';
import { OpenAiEmbeddingModel } from './openai-embedding.adapter.js';

const LLM_MODELS = Symbol('LLM_MODELS');
type LlmModels = { chat: ChatModel; embedding: EmbeddingModel };

// LangChain retries are off: the adapter owns retries so every provider behaves the same
const NO_RETRIES = 0;

// Only send the temperature when there is one: some models reject a value other than their own
const temperatureOf = ({ temperature }: ChatModelOptions) => (temperature === undefined ? {} : { temperature });

// The LangChain classes satisfy LangChainChat but declare wider types, so the cast is made once here
const asChat = (model: unknown) => model as LangChainChat;

function createChat(config: ConfigService<Env, true>): ChatModel {
  const get = <K extends keyof Env>(key: K) => config.get(key, { infer: true }) as Env[K];

  switch (get('LLM_PROVIDER')) {
    case 'mock':
      return new MockChatModel();
    case 'gemini': {
      const model = get('GEMINI_CHAT_MODEL');
      const apiKey = get('GEMINI_API_KEY');
      const create: ChatModelFactory = (options) =>
        asChat(
          new ChatGoogle({
            model,
            apiKey,
            maxOutputTokens: options.maxOutputTokens,
            maxRetries: NO_RETRIES,
            ...temperatureOf(options),
          }),
        );
      return new LangChainChatModel('gemini', model, create);
    }
    case 'openai': {
      const model = get('OPENAI_CHAT_MODEL');
      const apiKey = get('OPENAI_API_KEY');
      const create: ChatModelFactory = (options) =>
        asChat(
          new ChatOpenAI({
            model,
            apiKey,
            maxTokens: options.maxOutputTokens,
            maxRetries: NO_RETRIES,
            ...temperatureOf(options),
          }),
        );
      return new LangChainChatModel('openai', model, create);
    }
    case 'anthropic': {
      const model = get('ANTHROPIC_CHAT_MODEL');
      const apiKey = get('ANTHROPIC_API_KEY');
      const create: ChatModelFactory = (options) =>
        asChat(
          new ChatAnthropic({
            model,
            apiKey,
            maxTokens: options.maxOutputTokens,
            maxRetries: NO_RETRIES,
            ...temperatureOf(options),
          }),
        );
      return new LangChainChatModel('anthropic', model, create);
    }
  }
}

function createEmbedding(config: ConfigService<Env, true>): EmbeddingModel {
  const get = <K extends keyof Env>(key: K) => config.get(key, { infer: true }) as Env[K];

  switch (get('EMBEDDING_PROVIDER')) {
    case 'mock':
      return new MockEmbeddingModel();
    case 'gemini': {
      const client = new GoogleGenAI({ apiKey: get('GEMINI_API_KEY'), httpOptions: GEMINI_HTTP_OPTIONS });
      return new GeminiEmbeddingModel(client, get('GEMINI_EMBEDDING_MODEL'));
    }
    case 'openai': {
      const model = get('OPENAI_EMBEDDING_MODEL');
      const client = new OpenAIEmbeddings({
        model,
        apiKey: get('OPENAI_API_KEY'),
        dimensions: EMBEDDING_DIMENSIONS,
        maxRetries: 2,
        timeout: 30_000,
      });
      return new OpenAiEmbeddingModel(client, model);
    }
  }
}

// The only place that knows which provider is active. A new provider is one case in each function
export function createModels(config: ConfigService<Env, true>): LlmModels {
  return { chat: createChat(config), embedding: createEmbedding(config) };
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
