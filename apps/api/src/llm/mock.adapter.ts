import { EMBEDDING_DIMENSIONS } from '../database/schema.js';
import type { ChatModel, ChatRequest, ChatResult, EmbeddingModel } from './llm.ports.js';

const tokenize = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// FNV-1a: a small hash that is stable across runs and platforms
function hashWord(word: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Bag-of-words embedding: texts that share words get similar vectors
export class MockEmbeddingModel implements EmbeddingModel {
  readonly model = 'mock-embedding';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embed(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  private embed(text: string): number[] {
    const vector = Array.from({ length: this.dimensions }, () => 0);
    for (const word of tokenize(text)) {
      vector[hashWord(word) % this.dimensions] += 1;
    }
    const norm = Math.hypot(...vector);
    // A zero vector has no cosine distance, so fall back to a fixed unit vector
    if (norm === 0) {
      vector[0] = 1;
      return vector;
    }
    return vector.map((value) => value / norm);
  }
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// Returns a schema-valid answer that quotes the first source of the prompt
export class MockChatModel implements ChatModel {
  readonly provider = 'mock';
  readonly model = 'mock-chat';

  async generate(request: ChatRequest): Promise<ChatResult> {
    const firstSource = request.user.match(/<source id="1">\n?([\s\S]*?)\n?<\/source>/)?.[1] ?? '';
    const answerable = firstSource.length > 0;
    const text = JSON.stringify({
      answerable,
      answer: answerable ? `[mock] ${firstSource.slice(0, 200)}` : '[mock] No sources were provided.',
      citations: answerable ? [1] : [],
    });
    return {
      text,
      inputTokens: estimateTokens(request.system + request.user),
      outputTokens: estimateTokens(text),
    };
  }
}
