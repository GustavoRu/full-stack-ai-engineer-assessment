export const CHAT_MODEL = Symbol('CHAT_MODEL');
export const EMBEDDING_MODEL = Symbol('EMBEDDING_MODEL');

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema of the arguments
  parameters: object;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AssistantMessage = {
  role: 'assistant';
  content: string;
  toolCalls: ToolCall[];
  // Opaque: the adapter that produced it can replay it unchanged on the next call
  providerMessage?: unknown;
};

export type ChatMessage =
  | { role: 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  // A structured reply, or tools; when both are set, tools win
  responseSchema?: object;
  tools?: ToolDefinition[];
  // The model must call one of the tools instead of answering in plain text
  requireToolCall?: boolean;
  temperature?: number;
  maxOutputTokens: number;
  // Cancels the call when the question's overall deadline passes
  signal?: AbortSignal;
}

export interface ChatResult {
  // The JSON text of the reply when responseSchema was set
  text: string;
  toolCalls: ToolCall[];
  // Appended to the conversation as is before the next call
  assistantMessage: AssistantMessage;
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
