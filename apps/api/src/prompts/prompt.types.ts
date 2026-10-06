import type { ToolDefinition } from '../llm/llm.ports.js';

export interface PromptSource {
  // 1-based position in the retrieved list; this is what the model cites
  number: number;
  content: string;
}

export interface BuiltPrompt {
  version: string;
  system: string;
  user: string;
  responseSchema: object;
}

export interface PromptTemplate {
  readonly version: string;
  build(question: string, sources: PromptSource[]): BuiltPrompt;
}

export interface AgentPromptTemplate {
  readonly version: string;
  // The rules, with the search limit filled in
  system(maxSearches: number): string;
  // What the model reads first: the question, delimited
  userMessage(question: string): string;
  // A search result: passages with their numbers, delimited
  formatPassages(passages: PromptSource[]): string;
  readonly searchTool: ToolDefinition;
  readonly submitTool: ToolDefinition;
}
