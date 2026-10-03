export type SourceType = 'pdf' | 'text' | 'markdown' | 'pasted';
export type AnswerStatus = 'answered' | 'unverified' | 'not_found';

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

export interface Question {
  id: string;
  question: string;
  answer: string;
  status: AnswerStatus;
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  promptVersion: string;
  createdAt: string;
}
