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
