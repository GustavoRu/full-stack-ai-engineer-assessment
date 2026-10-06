import { LlmInvalidResponseError, LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';
import { OpenAiEmbeddingModel } from './openai-embedding.adapter.js';

const vectorOf = (value: number, length = 768) => Array.from({ length }, () => value);

function setup(client: { embedDocuments?: unknown; embedQuery?: unknown } = {}) {
  const fake = {
    embedDocuments: vi.fn().mockResolvedValue([vectorOf(0.1)]),
    embedQuery: vi.fn().mockResolvedValue(vectorOf(0.2)),
    ...client,
  };
  return { model: new OpenAiEmbeddingModel(fake as never, 'embedding-test'), fake };
}

describe('OpenAiEmbeddingModel', () => {
  it('reports its model name and the 768 dimensions the database column needs', () => {
    const { model } = setup();
    expect(model.model).toBe('embedding-test');
    expect(model.dimensions).toBe(768);
  });

  it('embeds documents and queries', async () => {
    const { model, fake } = setup();

    await expect(model.embedDocuments(['a chunk'])).resolves.toEqual([vectorOf(0.1)]);
    await expect(model.embedQuery('a question')).resolves.toEqual(vectorOf(0.2));

    expect(fake.embedDocuments).toHaveBeenCalledWith(['a chunk']);
    expect(fake.embedQuery).toHaveBeenCalledWith('a question');
  });

  it('does not call the provider for an empty list', async () => {
    const { model, fake } = setup();
    await expect(model.embedDocuments([])).resolves.toEqual([]);
    expect(fake.embedDocuments).not.toHaveBeenCalled();
  });

  it('rejects a response with a different number of vectors than texts', async () => {
    const { model } = setup({ embedDocuments: vi.fn().mockResolvedValue([]) });
    await expect(model.embedDocuments(['a chunk'])).rejects.toBeInstanceOf(LlmInvalidResponseError);
  });

  it('rejects vectors of the wrong dimension instead of storing them', async () => {
    const { model } = setup({
      embedDocuments: vi.fn().mockResolvedValue([vectorOf(0.1, 1536)]),
      embedQuery: vi.fn().mockResolvedValue(vectorOf(0.1, 1536)),
    });
    await expect(model.embedDocuments(['a chunk'])).rejects.toBeInstanceOf(LlmInvalidResponseError);
    await expect(model.embedQuery('a question')).rejects.toBeInstanceOf(LlmInvalidResponseError);
  });

  it('maps provider failures like the chat adapter does', async () => {
    const { model: limited } = setup({ embedQuery: vi.fn().mockRejectedValue({ status: 429 }) });
    await expect(limited.embedQuery('q')).rejects.toBeInstanceOf(LlmRateLimitError);

    const { model: broken } = setup({ embedDocuments: vi.fn().mockRejectedValue(new Error('socket hang up')) });
    await expect(broken.embedDocuments(['a'])).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});
