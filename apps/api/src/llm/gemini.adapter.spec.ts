import { ApiError, type GoogleGenAI } from '@google/genai';
import { GeminiEmbeddingModel, mapGeminiError } from './gemini.adapter.js';
import { LlmInvalidResponseError, LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';

const fakeClient = (models: Record<string, unknown>) => ({ models }) as unknown as GoogleGenAI;
const vectorOf = (value: number) => ({ values: Array.from({ length: 768 }, () => value) });

describe('mapGeminiError', () => {
  it('maps a 429 to a rate limit error', () => {
    expect(mapGeminiError(new ApiError({ message: 'quota', status: 429 }))).toBeInstanceOf(LlmRateLimitError);
  });

  it('maps other API errors and unknown failures to unavailable', () => {
    expect(mapGeminiError(new ApiError({ message: 'boom', status: 500 }))).toBeInstanceOf(LlmUnavailableError);
    expect(mapGeminiError(new Error('socket hang up'))).toBeInstanceOf(LlmUnavailableError);
  });
});

describe('GeminiEmbeddingModel', () => {
  it('embeds documents and queries with different task types at 768 dimensions', async () => {
    const embedContent = vi.fn().mockResolvedValue({ embeddings: [vectorOf(0.1)] });
    const model = new GeminiEmbeddingModel(fakeClient({ embedContent }), 'embedding-test');

    await model.embedDocuments(['a chunk']);
    await model.embedQuery('a question');

    expect(embedContent).toHaveBeenNthCalledWith(1, {
      model: 'embedding-test',
      contents: ['a chunk'],
      config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
    });
    expect(embedContent).toHaveBeenNthCalledWith(2, {
      model: 'embedding-test',
      contents: ['a question'],
      config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 },
    });
  });

  it('splits large inputs into batches of 100 and keeps the order', async () => {
    const embedContent = vi.fn(async ({ contents }: { contents: string[] }) => ({
      embeddings: contents.map((text) => vectorOf(Number(text))),
    }));
    const model = new GeminiEmbeddingModel(fakeClient({ embedContent }), 'embedding-test');

    const vectors = await model.embedDocuments(Array.from({ length: 150 }, (_, i) => String(i)));

    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(150);
    expect(vectors[0][0]).toBe(0);
    expect(vectors[149][0]).toBe(149);
  });

  it('rejects a response that does not match the request', async () => {
    const embedContent = vi.fn().mockResolvedValue({ embeddings: [] });
    const model = new GeminiEmbeddingModel(fakeClient({ embedContent }), 'embedding-test');
    await expect(model.embedDocuments(['a chunk'])).rejects.toBeInstanceOf(LlmInvalidResponseError);
  });
});
