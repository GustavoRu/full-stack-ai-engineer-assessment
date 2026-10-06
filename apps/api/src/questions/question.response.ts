import type { AnswerStatus, QuestionRow } from '../database/schema.js';

export type QuestionResponse = {
  id: string;
  question: string;
  answer: string;
  status: AnswerStatus;
  citations: { chunkIndex: number; content: string }[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  promptVersion: string;
  createdAt: string;
};

// Citations are stored as chunk indexes and resolved to chunk text when read
export function toQuestionResponse(row: QuestionRow, contents: Map<number, string>): QuestionResponse {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    citations: row.citations.map((chunkIndex) => ({ chunkIndex, content: contents.get(chunkIndex) ?? '' })),
    usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
    model: row.model,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
