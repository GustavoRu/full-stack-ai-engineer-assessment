import { MockChatModel, MockEmbeddingModel } from './mock.adapter.js';

const cosine = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

describe('MockEmbeddingModel', () => {
  const model = new MockEmbeddingModel();

  it('returns one unit vector of 768 dimensions per text', async () => {
    const vectors = await model.embedDocuments(['first text', 'second text']);
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(768);
      expect(Math.hypot(...vector)).toBeCloseTo(1);
    }
  });

  it('is deterministic', async () => {
    expect(await model.embedQuery('same input')).toEqual(await model.embedQuery('same input'));
  });

  it('places related text closer than unrelated text', async () => {
    const [query, related, unrelated] = await model.embedDocuments([
      'what is the capital of France',
      'Paris is the capital of France',
      'mitochondria produce energy for the cell',
    ]);
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it('returns a valid vector for text without words', async () => {
    const vector = await model.embedQuery('   ');
    expect(vector.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...vector)).toBeCloseTo(1);
  });
});

describe('MockChatModel', () => {
  const model = new MockChatModel();
  const request = { system: 'rules', responseSchema: {}, temperature: 0, maxOutputTokens: 100 };

  it('answers from the first source and cites it', async () => {
    const user = '<sources>\n<source id="1">\nParis is the capital.\n</source>\n</sources>\n\n<question>\nCapital?\n</question>';
    const result = await model.generate({ ...request, user });
    expect(JSON.parse(result.text)).toEqual({
      answerable: true,
      answer: '[mock] Paris is the capital.',
      citations: [1],
    });
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('reports not answerable when there are no sources', async () => {
    const result = await model.generate({ ...request, user: '<sources>\n\n</sources>' });
    expect(JSON.parse(result.text)).toMatchObject({ answerable: false, citations: [] });
  });
});
