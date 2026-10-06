import { EMBEDDING_DIMENSIONS } from '../database/schema.js';
import { textResult } from './chat-result.js';
import type { ChatModel, ChatRequest, ChatResult, EmbeddingModel, ToolCall } from './llm.ports.js';

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

const questionOf = (request: ChatRequest) => {
  const first = request.messages.find((message) => message.role === 'user')?.content ?? '';
  return first.match(/<question>\n?([\s\S]*?)\n?<\/question>/)?.[1] ?? first;
};

// What a model that read the passages would submit: quote the first one and cite it
function submitCall(lastToolResult: string): ToolCall {
  const first = lastToolResult.match(/<source id="(\d+)">\n?([\s\S]*?)\n?<\/source>/);
  const args = first
    ? { answerable: true, answer: `[mock] ${first[2].slice(0, 200)}`, citations: [Number(first[1])] }
    : { answerable: false, answer: '[mock] No passages were found.', citations: [] };
  return { id: 'mock-call-2', name: 'submit_answer', args };
}

// Searches once with the question as the query, then submits
function withTools(request: ChatRequest): ChatResult {
  const lastToolResult = request.messages.filter((message) => message.role === 'tool').at(-1);
  const canSearch = request.tools?.some((tool) => tool.name === 'search_document') ?? false;
  const call: ToolCall =
    lastToolResult === undefined && canSearch
      ? { id: 'mock-call-1', name: 'search_document', args: { query: questionOf(request) } }
      : submitCall(lastToolResult?.content ?? '');
  const toolCalls = [call];
  return {
    text: '',
    toolCalls,
    assistantMessage: { role: 'assistant', content: '', toolCalls },
    inputTokens: estimateTokens(request.system + request.messages.map((message) => message.content).join('')),
    outputTokens: estimateTokens(JSON.stringify(call.args)),
  };
}

const lastUserMessage = (request: ChatRequest) =>
  [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';

// Returns a schema-valid answer that quotes the first source of the prompt
export class MockChatModel implements ChatModel {
  readonly provider = 'mock';
  readonly model = 'mock-chat';

  async generate(request: ChatRequest): Promise<ChatResult> {
    if (request.tools?.length) return withTools(request);
    const user = lastUserMessage(request);
    const firstSource = user.match(/<source id="1">\n?([\s\S]*?)\n?<\/source>/)?.[1] ?? '';
    const answerable = firstSource.length > 0;
    const text = JSON.stringify({
      answerable,
      answer: answerable ? `[mock] ${firstSource.slice(0, 200)}` : '[mock] No sources were provided.',
      citations: answerable ? [1] : [],
    });
    return textResult(text, estimateTokens(request.system + user), estimateTokens(text));
  }
}
