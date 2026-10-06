import { z } from 'zod';
import type { AnswerStatus } from '../database/schema.js';
import { LlmInvalidResponseError } from '../llm/llm.errors.js';

export interface RetrievedChunk {
  chunkIndex: number;
  content: string;
  distance: number;
}

export interface ParsedAnswer {
  status: AnswerStatus;
  answer: string;
  // Chunk indexes of the valid cited sources
  citations: number[];
}

// Model output is untrusted input: the provider guarantees JSON syntax, not correct values
const modelAnswerSchema = z.object({
  answerable: z.boolean(),
  answer: z.string().trim(),
  citations: z.array(z.number().int()),
});

const DEFAULT_NOT_FOUND_ANSWER = 'The document does not cover this question.';

export function parseAnswer(rawText: string, retrieved: RetrievedChunk[]): ParsedAnswer {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new LlmInvalidResponseError('The model returned an invalid response. Try asking again.');
  }

  const result = modelAnswerSchema.safeParse(json);
  if (!result.success) {
    throw new LlmInvalidResponseError('The model returned an invalid response. Try asking again.');
  }
  const { answerable, answer, citations } = result.data;

  if (!answerable) {
    return { status: 'not_found', answer: answer || DEFAULT_NOT_FOUND_ANSWER, citations: [] };
  }
  // An answer claimed as answerable must say something
  if (answer.length === 0) {
    throw new LlmInvalidResponseError('The model returned an invalid response. Try asking again.');
  }

  // A citation is valid only if it points to a source that was actually sent
  const validCitations = [...new Set(citations)]
    .filter((sourceNumber) => sourceNumber >= 1 && sourceNumber <= retrieved.length)
    .map((sourceNumber) => retrieved[sourceNumber - 1].chunkIndex);

  return { status: validCitations.length > 0 ? 'answered' : 'unverified', answer, citations: validCitations };
}
