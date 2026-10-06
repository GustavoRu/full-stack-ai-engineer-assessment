import { stampRetryable } from '@langchain/core/errors';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { LlmInvalidResponseError, LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';
import type { ChatRequest } from './llm.ports.js';
import { type LangChainChat, LangChainChatModel, type RetryPolicy } from './langchain-chat.adapter.js';

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
const reply = (fields: ConstructorParameters<typeof AIMessage>[0] = { content: 'hi' }) =>
  new AIMessage({ usage_metadata: usage, ...(typeof fields === 'string' ? { content: fields } : fields) });

const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
const request: ChatRequest = {
  system: 'system text',
  messages: [{ role: 'user', content: 'user text' }],
  responseSchema: schema,
  temperature: 0.2,
  maxOutputTokens: 800,
};

type Overrides = {
  structured?: ReturnType<typeof vi.fn>;
  bound?: ReturnType<typeof vi.fn>;
  plain?: ReturnType<typeof vi.fn>;
};

// A stand-in for a LangChain chat model: every entry point is a spy the tests can script
function setup(overrides: Overrides = {}, policy: Partial<RetryPolicy> = {}, structuredMethod?: 'jsonSchema' | 'functionCalling') {
  const structured = overrides.structured ?? vi.fn().mockResolvedValue({ raw: reply('{"ok":true}'), parsed: { ok: true } });
  const bound = overrides.bound ?? vi.fn().mockResolvedValue(reply());
  const plain = overrides.plain ?? vi.fn().mockResolvedValue(reply());
  // The spies are loosely typed, so each one is cast to the method it stands in for
  type Plain = LangChainChat['invoke'];
  type Structured = ReturnType<LangChainChat['withStructuredOutput']>['invoke'];
  const model: LangChainChat = {
    invoke: plain as unknown as Plain,
    bindTools: vi.fn((_tools: unknown[]) => ({ invoke: bound as unknown as Plain })),
    withStructuredOutput: vi.fn((_schema: object, _config: { includeRaw: true }) => ({
      invoke: structured as unknown as Structured,
    })),
  };
  const create = vi.fn(() => model);
  const delay = vi.fn().mockResolvedValue(undefined);
  const adapter = new LangChainChatModel(
    'test-provider',
    'test-model',
    create,
    { maxAttempts: 3, attemptTimeoutMs: 1000, delay, ...policy },
    structuredMethod,
  );
  return { adapter, model, create, delay, structured, bound, plain };
}

describe('LangChainChatModel: structured replies', () => {
  it('sends the system prompt first, asks for the schema and returns the parsed object as JSON text', async () => {
    const { adapter, model, structured } = setup();

    const result = await adapter.generate(request);

    expect(model.withStructuredOutput).toHaveBeenCalledWith(schema, { includeRaw: true });
    const messages = structured.mock.calls[0][0];
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[0].content).toBe('system text');
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[1].content).toBe('user text');
    expect(result).toMatchObject({ text: '{"ok":true}', toolCalls: [], inputTokens: 10, outputTokens: 5 });
    expect(result.assistantMessage).toMatchObject({ role: 'assistant', content: '{"ok":true}', toolCalls: [] });
  });

  it('leaves the structured output method to the library unless the provider asks for one', async () => {
    const { adapter, model } = setup();
    await adapter.generate(request);
    expect(model.withStructuredOutput).toHaveBeenCalledWith(schema, { includeRaw: true });

    const asked = setup({}, {}, 'jsonSchema');
    await asked.adapter.generate(request);
    expect(asked.model.withStructuredOutput).toHaveBeenCalledWith(schema, { includeRaw: true, method: 'jsonSchema' });
  });

  it('does not keep the raw provider message of a structured reply, which could hold a tool call', async () => {
    const { adapter } = setup();
    const result = await adapter.generate(request);
    expect(result.assistantMessage.providerMessage).toBeUndefined();
  });

  it('builds the model with the temperature and output limit of the request', async () => {
    const { adapter, create } = setup();
    await adapter.generate(request);
    expect(create).toHaveBeenCalledWith({ temperature: 0.2, maxOutputTokens: 800 });
  });

  it('reports zero tokens when the provider sends no usage', async () => {
    const structured = vi.fn().mockResolvedValue({ raw: new AIMessage({ content: '{}' }), parsed: {} });
    const { adapter } = setup({ structured });
    await expect(adapter.generate(request)).resolves.toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it('answers 502 when the reply did not parse, instead of returning "null" as an answer', async () => {
    const structured = vi.fn().mockResolvedValue({ raw: reply('not json'), parsed: null });
    const { adapter } = setup({ structured });
    await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmInvalidResponseError);
  });
});

describe('LangChainChatModel: tools', () => {
  const tools = [
    {
      name: 'search_document',
      description: 'Search the document',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  ];

  it('binds the tools and returns the calls the model asked for, keeping the original message', async () => {
    const original = reply({
      content: '',
      tool_calls: [{ id: 'call-1', name: 'search_document', args: { query: 'capital' }, type: 'tool_call' }],
    });
    const { adapter, model } = setup({ bound: vi.fn().mockResolvedValue(original) });

    const result = await adapter.generate({ system: 's', messages: [{ role: 'user', content: 'q' }], tools, maxOutputTokens: 800 });

    const bindArg = vi.mocked(model.bindTools).mock.calls[0][0];
    expect(bindArg[0]).toMatchObject({ name: 'search_document', description: 'Search the document' });
    expect(result.toolCalls).toEqual([{ id: 'call-1', name: 'search_document', args: { query: 'capital' } }]);
    expect(result.assistantMessage.providerMessage).toBe(original);
    expect(result.assistantMessage.toolCalls).toEqual(result.toolCalls);
  });

  it('joins the text blocks of a reply whose content is a list of blocks', async () => {
    const blocks = reply({ content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }] });
    const { adapter } = setup({ bound: vi.fn().mockResolvedValue(blocks) });
    const result = await adapter.generate({ system: 's', messages: [{ role: 'user', content: 'q' }], tools, maxOutputTokens: 800 });
    expect(result.text).toBe('Hello there');
  });

  it('gives a tool call without an id a stable one', async () => {
    const noId = reply({ content: '', tool_calls: [{ name: 'search_document', args: { query: 'a' }, type: 'tool_call' }] });
    const { adapter } = setup({ bound: vi.fn().mockResolvedValue(noId) });
    const result = await adapter.generate({ system: 's', messages: [{ role: 'user', content: 'q' }], tools, maxOutputTokens: 800 });
    expect(result.toolCalls[0].id).toBe('call_0');
  });

  it('replays a conversation: the original assistant message, or one rebuilt from plain data, and tool results', async () => {
    const original = reply({ content: '', tool_calls: [{ id: 'a', name: 'search_document', args: { query: 'x' }, type: 'tool_call' }] });
    const { adapter, bound } = setup();

    await adapter.generate({
      system: 's',
      tools,
      maxOutputTokens: 800,
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'search_document', args: { query: 'x' } }], providerMessage: original },
        { role: 'tool', toolCallId: 'a', content: 'passages' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'b', name: 'search_document', args: { query: 'y' } }] },
        { role: 'tool', toolCallId: 'b', content: 'more passages' },
      ],
    });

    const sent = bound.mock.calls[0][0];
    expect(sent[2]).toBe(original);
    expect(sent[3]).toBeInstanceOf(ToolMessage);
    expect(sent[3]).toMatchObject({ tool_call_id: 'a', content: 'passages' });
    expect(sent[4]).toBeInstanceOf(AIMessage);
    expect(sent[4].tool_calls).toMatchObject([{ id: 'b', name: 'search_document', args: { query: 'y' } }]);
    expect(sent[5]).toMatchObject({ tool_call_id: 'b', content: 'more passages' });
  });
});

describe('LangChainChatModel: failures', () => {
  it('retries a 503 and succeeds, waiting between attempts', async () => {
    const structured = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ raw: reply('{"ok":true}'), parsed: { ok: true } });
    const { adapter, delay } = setup({ structured });

    await expect(adapter.generate(request)).resolves.toMatchObject({ text: '{"ok":true}' });
    expect(structured).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(1);
  });

  it('gives up after three attempts and reports a rate limit as 429', async () => {
    const structured = vi.fn().mockRejectedValue({ status: 429 });
    const { adapter, delay } = setup({ structured });

    await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmRateLimitError);
    expect(structured).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2]);
  });

  it('reads the status of the new Google package, which uses statusCode', async () => {
    const structured = vi.fn().mockRejectedValue({ statusCode: 429 });
    const { adapter } = setup({ structured });
    await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmRateLimitError);
  });

  it('does not retry a client error such as a bad key', async () => {
    const structured = vi.fn().mockRejectedValue({ status: 401 });
    const { adapter, delay } = setup({ structured });

    await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(structured).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not retry an error the library marks as permanent, such as a blocked prompt', async () => {
    const structured = vi.fn().mockRejectedValue(stampRetryable(new Error('prompt blocked'), false));
    const { adapter, delay } = setup({ structured });

    await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(structured).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('retries a 529 overloaded error and a 408 timeout', async () => {
    for (const status of [529, 408]) {
      const structured = vi
        .fn()
        .mockRejectedValueOnce({ status })
        .mockResolvedValueOnce({ raw: reply('{"ok":true}'), parsed: { ok: true } });
      const { adapter } = setup({ structured });
      await expect(adapter.generate(request)).resolves.toMatchObject({ text: '{"ok":true}' });
      expect(structured).toHaveBeenCalledTimes(2);
    }
  });

  it('turns a failure with an unexpected shape into 503 after retrying it as a network error', async () => {
    for (const failure of [new Error('socket hang up'), 'boom', null]) {
      const structured = vi.fn().mockRejectedValue(failure);
      const { adapter } = setup({ structured });
      await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmUnavailableError);
      expect(structured).toHaveBeenCalledTimes(3);
    }
  });

  it('cuts a call that hangs, using the per-attempt timeout', async () => {
    const hang = vi.fn(
      (_messages: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))),
    );
    const { adapter } = setup({ structured: hang }, { maxAttempts: 1, attemptTimeoutMs: 20 });

    await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(hang).toHaveBeenCalledTimes(1);
  });

  it('stops without retrying when the request was cancelled', async () => {
    const structured = vi.fn().mockRejectedValue(new Error('aborted'));
    const { adapter, delay } = setup({ structured });
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.generate({ ...request, signal: controller.signal })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(structured).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('passes a cancellation signal that follows the request signal', async () => {
    const { adapter, structured } = setup();
    const controller = new AbortController();

    await adapter.generate({ ...request, signal: controller.signal });

    const { signal } = structured.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('exposes the provider and model names', () => {
    const { adapter } = setup();
    expect(adapter.provider).toBe('test-provider');
    expect(adapter.model).toBe('test-model');
  });
});
