export const CHAT_MODEL = Symbol('CHAT_MODEL');
export const EMBEDDING_MODEL = Symbol('EMBEDDING_MODEL');

export interface ChatRequest {
  system: string;
  user: string;
  // JSON Schema the response must follow
  responseSchema: object;
  temperature: number;
  maxOutputTokens: number;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatModel {
  readonly provider: string;
  readonly model: string;
  generate(request: ChatRequest): Promise<ChatResult>;
}

export interface EmbeddingModel {
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
