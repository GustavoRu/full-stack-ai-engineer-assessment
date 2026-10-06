import { EMBEDDING_DIMENSIONS } from '../database/schema.js';
import { LlmInvalidResponseError } from './llm.errors.js';
import type { EmbeddingModel } from './llm.ports.js';
import { toLlmError } from './provider-error.js';

// The slice of LangChain's OpenAIEmbeddings that this adapter uses
interface EmbeddingsClient {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

const INVALID_RESPONSE = 'The embedding response did not match the request';

export class OpenAiEmbeddingModel implements EmbeddingModel {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly client: EmbeddingsClient,
    readonly model: string,
  ) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors = await this.call(() => this.client.embedDocuments(texts));
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new LlmInvalidResponseError(INVALID_RESPONSE);
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vector = await this.call(() => this.client.embedQuery(text));
    if (vector.length !== this.dimensions) throw new LlmInvalidResponseError(INVALID_RESPONSE);
    return vector;
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toLlmError(error);
    }
  }
}
