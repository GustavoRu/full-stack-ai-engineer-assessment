import { ApiError, type GoogleGenAI } from '@google/genai';
import { EMBEDDING_DIMENSIONS } from '../database/schema.js';
import { LlmInvalidResponseError, LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';
import type { ChatModel, ChatRequest, ChatResult, EmbeddingModel } from './llm.ports.js';

// Each attempt has its own 30 s timeout; 3 attempts means 2 retries, waiting 1-2 s and then 2-4 s (jitter on)
export const GEMINI_HTTP_OPTIONS = {
  timeout: 30_000,
  retryOptions: { attempts: 3, initialDelay: 1, expBase: 2, jitter: 0.2, httpStatusCodes: [429, 500, 502, 503, 504] },
};

const EMBEDDING_BATCH_SIZE = 100;

export function mapGeminiError(error: unknown): Error {
  if (error instanceof ApiError && error.status === 429) {
    return new LlmRateLimitError('The AI provider quota was exceeded. Try again in a minute.', { cause: error });
  }
  return new LlmUnavailableError('The AI provider is unavailable. Try again later.', { cause: error });
}

export class GeminiChatModel implements ChatModel {
  readonly provider = 'gemini';

  constructor(
    private readonly client: GoogleGenAI,
    readonly model: string,
  ) {}

  async generate(request: ChatRequest): Promise<ChatResult> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: request.user,
        config: {
          systemInstruction: request.system,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseSchema,
        },
      });
      const usage = response.usageMetadata;
      return {
        text: response.text ?? '',
        inputTokens: usage?.promptTokenCount ?? 0,
        // Thinking tokens are billed as output
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      };
    } catch (error) {
      throw mapGeminiError(error);
    }
  }
}

export class GeminiEmbeddingModel implements EmbeddingModel {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly client: GoogleGenAI,
    readonly model: string,
  ) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      vectors.push(...(await this.embed(texts.slice(start, start + EMBEDDING_BATCH_SIZE), 'RETRIEVAL_DOCUMENT')));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], 'RETRIEVAL_QUERY');
    return vector;
  }

  private async embed(texts: string[], taskType: string): Promise<number[][]> {
    let vectors: number[][];
    try {
      const response = await this.client.models.embedContent({
        model: this.model,
        contents: texts,
        config: { taskType, outputDimensionality: this.dimensions },
      });
      vectors = (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
    } catch (error) {
      throw mapGeminiError(error);
    }
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new LlmInvalidResponseError('The embedding response did not match the request');
    }
    return vectors;
  }
}
