import type { AnswerMode, AnswerStatus, QuestionRow } from '../database/schema.js';

export type QuestionResponse = {
  id: string;
  question: string;
  answer: string;
  status: AnswerStatus;
  citations: { chunkIndex: number; content: string }[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  promptVersion: string;
  mode: AnswerMode;
  // The chunk indexes stay in the audit table: the response only says how many passages each search found
  searches: { query: string; sourceCount: number }[];
  modelCalls: number;
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
    mode: row.mode,
    searches: row.searches.map((step) => ({ query: step.query, sourceCount: step.chunkIndexes.length })),
    modelCalls: row.modelCalls,
    createdAt: row.createdAt.toISOString(),
  };
}
