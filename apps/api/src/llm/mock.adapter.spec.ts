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
  const asUser = (content: string) => ({ ...request, messages: [{ role: 'user' as const, content }] });

  it('answers from the first source and cites it', async () => {
    const user = '<sources>\n<source id="1">\nParis is the capital.\n</source>\n</sources>\n\n<question>\nCapital?\n</question>';
    const result = await model.generate(asUser(user));
    expect(JSON.parse(result.text)).toEqual({
      answerable: true,
      answer: '[mock] Paris is the capital.',
      citations: [1],
    });
    expect(result.toolCalls).toEqual([]);
    expect(result.assistantMessage).toMatchObject({ role: 'assistant', content: result.text });
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('reports not answerable when there are no sources', async () => {
    const result = await model.generate(asUser('<sources>\n\n</sources>'));
    expect(JSON.parse(result.text)).toMatchObject({ answerable: false, citations: [] });
  });

  describe('with tools', () => {
    const tools = [
      { name: 'search_document', description: 'search', parameters: {} },
      { name: 'submit_answer', description: 'submit', parameters: {} },
    ];
    const question = { role: 'user' as const, content: '<question>\nWhat is the capital of France?\n</question>' };
    const base = { system: 'rules', maxOutputTokens: 100 };

    it('searches first, using the text of the question', async () => {
      const result = await model.generate({ ...base, tools, messages: [question] });

      expect(result.toolCalls).toEqual([
        { id: 'mock-call-1', name: 'search_document', args: { query: 'What is the capital of France?' } },
      ]);
      expect(result.assistantMessage).toMatchObject({ role: 'assistant', toolCalls: result.toolCalls });
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
    });

    it('submits an answer that quotes and cites the first passage it was given', async () => {
      const passages = '<sources>\n<source id="2">\nParis is the capital of France.\n</source>\n</sources>';
      const result = await model.generate({
        ...base,
        tools,
        messages: [
          question,
          { role: 'assistant', content: '', toolCalls: [{ id: 'mock-call-1', name: 'search_document', args: {} }] },
          { role: 'tool', toolCallId: 'mock-call-1', content: passages },
        ],
      });

      expect(result.toolCalls).toEqual([
        {
          id: 'mock-call-2',
          name: 'submit_answer',
          args: { answerable: true, answer: '[mock] Paris is the capital of France.', citations: [2] },
        },
      ]);
    });

    it('says it found nothing when the search returned no passages', async () => {
      const result = await model.generate({
        ...base,
        tools,
        messages: [question, { role: 'tool', toolCallId: 'mock-call-1', content: 'No passages were found.' }],
      });
      expect(result.toolCalls[0]).toMatchObject({
        name: 'submit_answer',
        args: { answerable: false, citations: [] },
      });
    });

    it('submits at once when searching is no longer offered', async () => {
      const result = await model.generate({ ...base, tools: [tools[1]], messages: [question] });
      expect(result.toolCalls[0]).toMatchObject({ name: 'submit_answer', args: { answerable: false } });
    });
  });
});
