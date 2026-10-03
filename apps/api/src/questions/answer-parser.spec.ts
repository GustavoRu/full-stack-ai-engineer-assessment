import { LlmInvalidResponseError } from '../llm/llm.errors.js';
import { parseAnswer, type RetrievedChunk } from './answer-parser.js';

// Source numbers 1, 2, 3 map to chunk indexes 12, 4, 9
const retrieved: RetrievedChunk[] = [
  { chunkIndex: 12, content: 'first', distance: 0.1 },
  { chunkIndex: 4, content: 'second', distance: 0.2 },
  { chunkIndex: 9, content: 'third', distance: 0.3 },
];

const raw = (value: unknown) => JSON.stringify(value);

describe('parseAnswer', () => {
  it('marks an answer with valid citations as answered and maps them to chunk indexes', () => {
    expect(parseAnswer(raw({ answerable: true, answer: 'Paris.', citations: [2, 1] }), retrieved)).toEqual({
      status: 'answered',
      answer: 'Paris.',
      citations: [4, 12],
    });
  });

  it('drops duplicate and out-of-range citations', () => {
    const parsed = parseAnswer(raw({ answerable: true, answer: 'Paris.', citations: [1, 1, 0, 4, 99, 3] }), retrieved);
    expect(parsed).toMatchObject({ status: 'answered', citations: [12, 9] });
  });

  it('marks an answer without any valid citation as unverified', () => {
    expect(parseAnswer(raw({ answerable: true, answer: 'Paris.', citations: [] }), retrieved).status).toBe('unverified');
    expect(parseAnswer(raw({ answerable: true, answer: 'Paris.', citations: [7] }), retrieved).status).toBe(
      'unverified',
    );
    expect(parseAnswer(raw({ answerable: true, answer: 'Paris.', citations: [1] }), []).status).toBe('unverified');
  });

  it('marks a not answerable response as not_found and ignores its citations', () => {
    expect(parseAnswer(raw({ answerable: false, answer: 'Not covered.', citations: [1] }), retrieved)).toEqual({
      status: 'not_found',
      answer: 'Not covered.',
      citations: [],
    });
  });

  it('rejects output that is not JSON, such as a truncated response', () => {
    expect(() => parseAnswer('{"answerable": true, "answer": "Par', retrieved)).toThrow(LlmInvalidResponseError);
    expect(() => parseAnswer('', retrieved)).toThrow(LlmInvalidResponseError);
  });

  it('rejects JSON with the wrong shape or an empty answer', () => {
    expect(() => parseAnswer(raw({ answer: 'Paris.' }), retrieved)).toThrow(LlmInvalidResponseError);
    expect(() => parseAnswer(raw({ answerable: 'yes', answer: 'Paris.', citations: [] }), retrieved)).toThrow(
      LlmInvalidResponseError,
    );
    expect(() => parseAnswer(raw({ answerable: true, answer: '  ', citations: [] }), retrieved)).toThrow(
      LlmInvalidResponseError,
    );
  });
});
