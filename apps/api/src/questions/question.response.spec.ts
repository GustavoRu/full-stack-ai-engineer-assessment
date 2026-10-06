import type { QuestionRow } from '../database/schema.js';
import { toQuestionResponse } from './question.response.js';

const row: QuestionRow = {
  id: 'q-1',
  documentId: 'd-1',
  userId: 'u-1',
  question: 'What is the capital of France?',
  answer: 'Paris.',
  status: 'answered',
  citations: [3],
  retrieved: [
    { chunkIndex: 3, distance: 0.1 },
    { chunkIndex: 4, distance: 0.3 },
  ],
  promptVersion: 'agent-v1',
  provider: 'mock',
  model: 'mock-chat',
  inputTokens: 100,
  outputTokens: 20,
  latencyMs: 5,
  mode: 'agentic',
  searches: [{ query: 'capital of France', chunkIndexes: [3, 4] }],
  modelCalls: 2,
  createdAt: new Date('2026-10-04T12:00:00Z'),
};

describe('toQuestionResponse', () => {
  const response = toQuestionResponse(row, new Map([[3, 'Paris is the capital of France.']]));

  it('reports the mode and the number of model calls', () => {
    expect(response).toMatchObject({ mode: 'agentic', modelCalls: 2, promptVersion: 'agent-v1' });
  });

  it('reports each search with how many passages it found, not which ones', () => {
    expect(response.searches).toEqual([{ query: 'capital of France', sourceCount: 2 }]);
  });

  it('still resolves the cited passages and the token usage', () => {
    expect(response.citations).toEqual([{ chunkIndex: 3, content: 'Paris is the capital of France.' }]);
    expect(response.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('reads a classic answer as one call and no searches', () => {
    const classic = toQuestionResponse({ ...row, mode: 'classic', searches: [], modelCalls: 1 }, new Map());
    expect(classic).toMatchObject({ mode: 'classic', searches: [], modelCalls: 1 });
  });
});
