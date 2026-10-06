export type SourceType = 'pdf' | 'text' | 'markdown' | 'pasted';
export type AnswerStatus = 'answered' | 'unverified' | 'not_found';
export type AnswerMode = 'classic' | 'agentic';

export interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  charCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface Citation {
  chunkIndex: number;
  content: string;
}

export interface SearchStep {
  query: string;
  // How many passages the search found
  sourceCount: number;
}

export interface Question {
  id: string;
  question: string;
  answer: string;
  status: AnswerStatus;
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  promptVersion: string;
  mode: AnswerMode;
  searches: SearchStep[];
  modelCalls: number;
  createdAt: string;
}
