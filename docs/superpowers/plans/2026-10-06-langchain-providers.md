# LangChain Providers Implementation Plan (plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat model selectable among Gemini, OpenAI, Anthropic and the mock through one LangChain adapter behind our own port, add OpenAI embeddings, and keep the classic answer mode working exactly as today.

**Architecture:** The chat port grows from "one prompt in, one JSON reply out" to a conversation that can carry tool calls, so plan 5 can add the agentic mode without touching the port again. One `LangChainChatModel` adapter, built from a factory per provider, serves Gemini, OpenAI and Anthropic. It owns retries, per-attempt timeouts, cancellation and error mapping, so every provider behaves the same. Embeddings stay on their own port, selected by their own setting.

**Tech Stack:** NestJS 12, TypeScript 6, `@langchain/core`, `@langchain/google` (pinned), `@langchain/openai`, `@langchain/anthropic`, `@google/genai` (embeddings only), zod 4, vitest.

**Spec:** [docs/superpowers/specs/2026-10-06-langchain-providers-and-agentic-mode-design.md](../specs/2026-10-06-langchain-providers-and-agentic-mode-design.md), sections 3, 4, 14 and 15. This plan is "Plan 4" of section 15. Plan 5 (agentic mode) is written after this one lands.

**Plan series:**

1. to 3. Backend, frontend, infrastructure and delivery: done and merged.
4. Providers through LangChain (this plan).
5. Agentic mode: not written yet.

## Global Constraints

- Our ports stay ours. LangChain is imported only in `langchain-chat.adapter.ts`, `openai-embedding.adapter.ts` and `llm.module.ts`. Nothing else in the code imports a vendor SDK type.
- `@langchain/google` is pinned to exactly `0.2.9` (no caret). The other LangChain packages use caret ranges.
- `@google/genai` stays: the Gemini embedding adapter uses it.
- The classic mode behaves as before. `qa-v1` is not edited. The same 5 questions about `docs/CHALLENGE.md` must still be answered against real Gemini.
- Default models: `gpt-4o-mini`, `claude-haiku-4-5`, `text-embedding-3-small` with `dimensions: 768`. OpenAI and Anthropic are wired and unit-tested but not verified against their real APIs, and the README says so.
- Error mapping: provider status 429 becomes `LlmRateLimitError` (HTTP 429); a malformed structured reply becomes `LlmInvalidResponseError` (502); anything else, including aborts, timeouts and network failures, becomes `LlmUnavailableError` (503).
- Retries: up to 3 attempts per call, 30 s timeout per attempt, waiting 1-2 s and then 2-4 s between attempts. LangChain's own retries are turned off (`maxRetries: 0`) so attempts are not multiplied.
- Document text, questions, answers and keys are never logged.
- Code comments are in English, one line, with no task identifiers.
- Commits follow Conventional Commits and carry no co-author or AI attribution trailer.
- Work happens on the branch `feat/langchain-tool-calling` in this checkout. No worktrees.
- Free disk space must be at least 2 GB before installing packages: `df -h /System/Volumes/Data`.
- API tests: `pnpm test` (unit) and `pnpm test:int` (needs `docker compose up -d db`) from `apps/api`.

## Review Focus

Conditions the spec implies but the happy-path tests do not exercise, most likely first. Each has a test in the task that owns it.

1. **A provider error with an unexpected shape must still become a 503, never a 500.** A rejection with no status, a string, or `null` goes through `toLlmError`. Task 2.
2. **A hung provider call must not hold the request.** Each attempt has its own timeout and the request's cancellation signal also aborts it, without retrying. Task 2.
3. **A misconfigured provider must stop the app at startup with a message that names the setting.** Missing key for the chosen provider, and `anthropic` without `EMBEDDING_PROVIDER`. Task 4.
4. **An embedding provider that returns the wrong number of vectors or the wrong dimension must not store anything.** Mixing dimensions in one column breaks search for the whole document. Task 3.
5. **A structured reply that did not parse must be a 502, not an empty answer.** The adapter must not turn `null` into `"null"` text. Task 2.

## Checkpoints

| After task | What to review |
|---|---|
| 2 | The port and the adapter: this is the interface plan 5 builds on |
| 5 | The whole branch: documentation accuracy and the real Gemini measurement |

## File Structure

```
apps/api/src/llm/
├── llm.ports.ts                  port types: messages, tools, request, result (modified)
├── chat-result.ts                textResult(): builds a ChatResult from plain text (new)
├── provider-error.ts             statusOf, RETRYABLE_STATUSES, toLlmError (new)
├── langchain-chat.adapter.ts     LangChainChatModel and message conversion (new)
├── openai-embedding.adapter.ts   OpenAiEmbeddingModel (new)
├── gemini.adapter.ts             keeps only the embedding model (modified)
├── mock.adapter.ts               speaks the new port shape (modified)
└── llm.module.ts                 createModels(): the only place that knows the providers (modified)
apps/api/src/config/env.ts        providers, keys, models, temperature (modified)
apps/api/src/questions/questions.service.ts   new request shape, temperature from config (modified)
```

---

### Task 1: The chat port with messages and tools

**Files:**
- Modify: `apps/api/src/llm/llm.ports.ts`, `apps/api/src/llm/mock.adapter.ts`, `apps/api/src/llm/mock.adapter.spec.ts`
- Modify: `apps/api/src/llm/gemini.adapter.ts`, `apps/api/src/llm/gemini.adapter.spec.ts`
- Modify: `apps/api/src/questions/questions.service.ts`, `apps/api/src/questions/questions.service.spec.ts`
- Create: `apps/api/src/llm/chat-result.ts`, `apps/api/src/llm/chat-result.spec.ts`

**Interfaces:**
- Consumes: the current `ChatModel`, `ChatRequest`, `ChatResult` from `llm.ports.ts`.
- Produces:
  - `ToolDefinition`, `ToolCall`, `ChatMessage`, and the new `ChatRequest` / `ChatResult` as written in step 3.
  - `textResult(text: string, inputTokens: number, outputTokens: number): ChatResult`.
  - A service that sends `{ system, messages: [{ role: 'user', content }], responseSchema, temperature, maxOutputTokens }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/llm/chat-result.spec.ts`:

```ts
import { textResult } from './chat-result.js';

describe('textResult', () => {
  it('wraps plain text as an assistant turn without tool calls', () => {
    expect(textResult('{"ok":true}', 12, 3)).toEqual({
      text: '{"ok":true}',
      toolCalls: [],
      assistantMessage: { role: 'assistant', content: '{"ok":true}', toolCalls: [] },
      inputTokens: 12,
      outputTokens: 3,
    });
  });
});
```

In `apps/api/src/llm/mock.adapter.spec.ts`, replace the whole `describe('MockChatModel', ...)` block with:

```ts
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
});
```

In `apps/api/src/llm/gemini.adapter.spec.ts`, replace the `describe('GeminiChatModel', ...)` block with:

```ts
describe('GeminiChatModel', () => {
  const request = {
    system: 'system text',
    messages: [{ role: 'user' as const, content: 'user text' }],
    responseSchema: { type: 'object' },
    temperature: 0.2,
    maxOutputTokens: 800,
  };

  it('sends the prompt parts and maps text and usage, counting thinking tokens as output', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"ok":true}',
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 10 },
    });
    const model = new GeminiChatModel(fakeClient({ generateContent }), 'gemini-test');

    await expect(model.generate(request)).resolves.toMatchObject({ text: '{"ok":true}', inputTokens: 120, outputTokens: 40 });
    expect(generateContent).toHaveBeenCalledWith({
      model: 'gemini-test',
      contents: 'user text',
      config: {
        systemInstruction: 'system text',
        temperature: 0.2,
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
      },
    });
  });

  it('translates provider failures', async () => {
    const generateContent = vi.fn().mockRejectedValue(new ApiError({ message: 'quota', status: 429 }));
    const model = new GeminiChatModel(fakeClient({ generateContent }), 'gemini-test');
    await expect(model.generate(request)).rejects.toBeInstanceOf(LlmRateLimitError);
  });
});
```

In `apps/api/src/questions/questions.service.spec.ts`:

1. Add the import `import { textResult } from '../llm/chat-result.js';` after the `llm.errors` import.
2. In `setup`, replace the `generate` definition with:

```ts
  const generate = vi.fn(async (_request: ChatRequest) =>
    textResult(options.chatText ?? JSON.stringify({ answerable: true, answer: 'Paris.', citations: [1] }), 100, 20),
  );
```

3. In the first test, replace the lines from `const request = generate.mock.calls[0][0];` through `expect(request.user).toContain('What is the capital of France?');` (three lines) with these four, and keep the `expect(request).toMatchObject({ temperature: 0.2, maxOutputTokens: 800 });` line that follows:

```ts
    const request = generate.mock.calls[0][0];
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].content).toContain('Paris is the capital of France.');
    expect(request.messages[0].content).toContain('What is the capital of France?');
```

4. In the null-bytes test, replace `expect(generate.mock.calls[0][0].user).not.toContain('\u0000');` with:

```ts
    expect(generate.mock.calls[0][0].messages[0].content).not.toContain('\u0000');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm test src/llm src/questions`
Expected: FAIL. `chat-result.spec.ts` cannot find `./chat-result.js`, and the mock, Gemini and service specs fail because the code still reads `request.user`.

- [ ] **Step 3: Replace `apps/api/src/llm/llm.ports.ts`**

```ts
export const CHAT_MODEL = Symbol('CHAT_MODEL');
export const EMBEDDING_MODEL = Symbol('EMBEDDING_MODEL');

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema of the arguments
  parameters: object;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AssistantMessage = {
  role: 'assistant';
  content: string;
  toolCalls: ToolCall[];
  // Opaque: the adapter that produced it can replay it unchanged on the next call
  providerMessage?: unknown;
};

export type ChatMessage =
  | { role: 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  // A structured reply, or tools; when both are set, tools win
  responseSchema?: object;
  tools?: ToolDefinition[];
  temperature?: number;
  maxOutputTokens: number;
  // Cancels the call when the question's overall deadline passes
  signal?: AbortSignal;
}

export interface ChatResult {
  // The JSON text of the reply when responseSchema was set
  text: string;
  toolCalls: ToolCall[];
  // Appended to the conversation as is before the next call
  assistantMessage: AssistantMessage;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatModel {
  readonly provider: string;
  readonly model: string;
  generate(request: ChatRequest): Promise<ChatResult>;
}

export interface EmbeddingModel {
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
```

- [ ] **Step 4: Create `apps/api/src/llm/chat-result.ts`**

```ts
import type { ChatResult } from './llm.ports.js';

// A reply that is only text: no tool calls, nothing to replay
export function textResult(text: string, inputTokens: number, outputTokens: number): ChatResult {
  return {
    text,
    toolCalls: [],
    assistantMessage: { role: 'assistant', content: text, toolCalls: [] },
    inputTokens,
    outputTokens,
  };
}
```

- [ ] **Step 5: Update the mock adapter**

In `apps/api/src/llm/mock.adapter.ts`, add `import { textResult } from './chat-result.js';` below the schema import, and replace everything from the comment `// Returns a schema-valid answer that quotes the first source of the prompt` to the end of the file with:

```ts
const lastUserMessage = (request: ChatRequest) =>
  [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';

// Returns a schema-valid answer that quotes the first source of the prompt
export class MockChatModel implements ChatModel {
  readonly provider = 'mock';
  readonly model = 'mock-chat';

  async generate(request: ChatRequest): Promise<ChatResult> {
    const user = lastUserMessage(request);
    const firstSource = user.match(/<source id="1">\n?([\s\S]*?)\n?<\/source>/)?.[1] ?? '';
    const answerable = firstSource.length > 0;
    const text = JSON.stringify({
      answerable,
      answer: answerable ? `[mock] ${firstSource.slice(0, 200)}` : '[mock] No sources were provided.',
      citations: answerable ? [1] : [],
    });
    return textResult(text, estimateTokens(request.system + user), estimateTokens(text));
  }
}
```

- [ ] **Step 6: Update the Gemini chat adapter so the code keeps compiling**

In `apps/api/src/llm/gemini.adapter.ts`, add `import { textResult } from './chat-result.js';` after the `llm.errors` import, and replace the body of `GeminiChatModel.generate` with:

```ts
  async generate(request: ChatRequest): Promise<ChatResult> {
    if (request.tools?.length) throw new Error('The native Gemini adapter does not support tools');
    const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: user,
        config: {
          systemInstruction: request.system,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseSchema,
        },
      });
      const usage = response.usageMetadata;
      // Thinking tokens are billed as output
      const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
      return textResult(response.text ?? '', usage?.promptTokenCount ?? 0, outputTokens);
    } catch (error) {
      throw mapGeminiError(error);
    }
  }
```

(This adapter is a bridge: task 4 deletes it. It exists so every task ends with a compiling, passing tree.)

- [ ] **Step 7: Update the service request**

In `apps/api/src/questions/questions.service.ts`, replace the model invocation block:

```ts
      result = await this.chat.generate({
        system: prompt.system,
        user: prompt.user,
        responseSchema: prompt.responseSchema,
        temperature: TEMPERATURE,
        maxOutputTokens: this.maxOutputTokens,
      });
```

with:

```ts
      result = await this.chat.generate({
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        responseSchema: prompt.responseSchema,
        temperature: TEMPERATURE,
        maxOutputTokens: this.maxOutputTokens,
      });
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/api && pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: all unit tests pass (one more than before: `chat-result.spec.ts`), `tsc` prints nothing, lint is clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "refactor(api): let the chat port carry messages and tool calls"
```

---

### Task 2: The LangChain chat adapter

**Files:**
- Modify: `apps/api/package.json`, `apps/api/pnpm-lock.yaml`
- Create: `apps/api/src/llm/provider-error.ts`, `apps/api/src/llm/provider-error.spec.ts`
- Create: `apps/api/src/llm/langchain-chat.adapter.ts`, `apps/api/src/llm/langchain-chat.adapter.spec.ts`

**Interfaces:**
- Consumes: `ChatModel`, `ChatRequest`, `ChatResult`, `ChatMessage`, `ToolCall`, `ToolDefinition` from Task 1; `LlmRateLimitError`, `LlmUnavailableError`, `LlmInvalidResponseError`.
- Produces:
  - `statusOf(error: unknown): number | undefined`, `RETRYABLE_STATUSES: ReadonlySet<number>`, `toLlmError(error: unknown): Error`.
  - `LangChainChat` (the slice of a LangChain model the adapter uses), `ChatModelFactory = (options: { temperature?: number; maxOutputTokens: number }) => LangChainChat`.
  - `RetryPolicy = { maxAttempts: number; attemptTimeoutMs: number; delay(attempt: number): Promise<void> }` and `DEFAULT_RETRY_POLICY`.
  - `class LangChainChatModel implements ChatModel` with constructor `(provider: string, model: string, create: ChatModelFactory, policy?: RetryPolicy)`.

- [ ] **Step 1: Install the packages**

```bash
df -h /System/Volumes/Data | tail -1
cd apps/api
pnpm add -E @langchain/google@0.2.9
pnpm add @langchain/core @langchain/openai @langchain/anthropic
grep -nE '"@langchain/(core|google|openai|anthropic)"' package.json
```

Expected: free space is above 2 GB, and the four packages appear in `dependencies`, with `@langchain/google` as `"0.2.9"` without a caret.

- [ ] **Step 2: Write the failing tests for the error helpers**

Create `apps/api/src/llm/provider-error.spec.ts`:

```ts
import { LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';
import { RETRYABLE_STATUSES, statusOf, toLlmError } from './provider-error.js';

describe('statusOf', () => {
  it('reads the status from the shapes the providers use', () => {
    expect(statusOf({ status: 429 })).toBe(429);
    expect(statusOf({ statusCode: 503 })).toBe(503);
    expect(statusOf({ response: { status: 500 } })).toBe(500);
  });

  it('returns undefined for anything that has no numeric status', () => {
    expect(statusOf(new Error('socket hang up'))).toBeUndefined();
    expect(statusOf({ status: '429' })).toBeUndefined();
    expect(statusOf('boom')).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
    expect(statusOf(undefined)).toBeUndefined();
  });
});

describe('toLlmError', () => {
  it('maps a 429 to a rate limit error and keeps the cause', () => {
    const cause = { status: 429 };
    const mapped = toLlmError(cause);
    expect(mapped).toBeInstanceOf(LlmRateLimitError);
    expect((mapped as Error).cause).toBe(cause);
  });

  it('maps every other failure, including odd shapes, to unavailable', () => {
    for (const failure of [{ status: 401 }, { statusCode: 500 }, new Error('boom'), 'boom', null, undefined]) {
      expect(toLlmError(failure)).toBeInstanceOf(LlmUnavailableError);
    }
  });
});

describe('RETRYABLE_STATUSES', () => {
  it('retries rate limits and server errors but not client errors', () => {
    for (const status of [429, 500, 502, 503, 504]) expect(RETRYABLE_STATUSES.has(status)).toBe(true);
    for (const status of [400, 401, 403, 404]) expect(RETRYABLE_STATUSES.has(status)).toBe(false);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm test src/llm/provider-error`
Expected: FAIL, `Cannot find module './provider-error.js'`.

- [ ] **Step 4: Create `apps/api/src/llm/provider-error.ts`**

```ts
import { LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

// The providers expose the HTTP status in different places: status, statusCode or response.status
export function statusOf(error: unknown): number | undefined {
  const shape = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null | undefined;
  const status = shape?.status ?? shape?.statusCode ?? shape?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

export function toLlmError(error: unknown): Error {
  if (statusOf(error) === 429) {
    return new LlmRateLimitError('The AI provider quota was exceeded. Try again in a minute.', { cause: error });
  }
  return new LlmUnavailableError('The AI provider is unavailable. Try again later.', { cause: error });
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd apps/api && pnpm test src/llm/provider-error`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing tests for the adapter**

Create `apps/api/src/llm/langchain-chat.adapter.spec.ts`:

```ts
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
function setup(overrides: Overrides = {}, policy: Partial<RetryPolicy> = {}) {
  const structured = overrides.structured ?? vi.fn().mockResolvedValue({ raw: reply('{"ok":true}'), parsed: { ok: true } });
  const bound = overrides.bound ?? vi.fn().mockResolvedValue(reply());
  const plain = overrides.plain ?? vi.fn().mockResolvedValue(reply());
  const model: LangChainChat = {
    invoke: plain,
    bindTools: vi.fn(() => ({ invoke: bound })),
    withStructuredOutput: vi.fn(() => ({ invoke: structured })),
  };
  const create = vi.fn(() => model);
  const delay = vi.fn().mockResolvedValue(undefined);
  const adapter = new LangChainChatModel('test-provider', 'test-model', create, {
    maxAttempts: 3,
    attemptTimeoutMs: 1000,
    delay,
    ...policy,
  });
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

  it('turns a failure with an unexpected shape into 503 after retrying it as a network error', async () => {
    for (const failure of [new Error('socket hang up'), 'boom', null]) {
      const structured = vi.fn().mockRejectedValue(failure);
      const { adapter } = setup({ structured });
      await expect(adapter.generate(request)).rejects.toBeInstanceOf(LlmUnavailableError);
      expect(structured).toHaveBeenCalledTimes(3);
    }
  });

  it('cuts a call that hangs, using the per-attempt timeout', async () => {
    const hang = vi.fn((_messages: unknown, options?: { signal?: AbortSignal }) =>
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
```

- [ ] **Step 7: Run them to verify they fail**

Run: `cd apps/api && pnpm test src/llm/langchain-chat`
Expected: FAIL, `Cannot find module './langchain-chat.adapter.js'`.

- [ ] **Step 8: Create `apps/api/src/llm/langchain-chat.adapter.ts`**

```ts
import { setTimeout as sleep } from 'node:timers/promises';
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { LlmInvalidResponseError } from './llm.errors.js';
import type { ChatMessage, ChatModel, ChatRequest, ChatResult, ToolCall, ToolDefinition } from './llm.ports.js';
import { RETRYABLE_STATUSES, statusOf, toLlmError } from './provider-error.js';

type InvokeOptions = { signal?: AbortSignal };
type Invokable<T> = { invoke(messages: BaseMessage[], options?: InvokeOptions): Promise<T> };

// The slice of a LangChain chat model that this adapter uses
export interface LangChainChat extends Invokable<AIMessage> {
  bindTools(tools: ReturnType<typeof tool>[]): Invokable<AIMessage>;
  withStructuredOutput(schema: object, config: { includeRaw: true }): Invokable<{ raw: AIMessage; parsed: unknown }>;
}

export interface ChatModelOptions {
  temperature?: number;
  maxOutputTokens: number;
}

// Builds a model with the limits of one request: each provider names these options differently
export type ChatModelFactory = (options: ChatModelOptions) => LangChainChat;

export interface RetryPolicy {
  maxAttempts: number;
  attemptTimeoutMs: number;
  delay(attempt: number): Promise<void>;
}

// 3 attempts of 30 s each, waiting 1-2 s and then 2-4 s between them
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  attemptTimeoutMs: 30_000,
  delay: (attempt) => sleep(1000 * 2 ** (attempt - 1) * (1 + Math.random())),
};

const INVALID_REPLY = 'The model returned an invalid response. Try asking again.';

const toLangChainTool = (definition: ToolDefinition) =>
  // The tool never runs inside LangChain: the loop that owns the conversation executes it
  tool(async () => '', { name: definition.name, description: definition.description, schema: definition.parameters });

function toLangChainMessage(message: ChatMessage): BaseMessage {
  switch (message.role) {
    case 'user':
      return new HumanMessage(message.content);
    case 'tool':
      return new ToolMessage({ tool_call_id: message.toolCallId, content: message.content });
    case 'assistant':
      // The original message keeps provider details that a rebuilt one would lose
      if (message.providerMessage instanceof AIMessage) return message.providerMessage;
      return new AIMessage({
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({ id: call.id, name: call.name, args: call.args, type: 'tool_call' as const })),
      });
  }
}

function textOf(content: AIMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('');
}

const tokensOf = (message: AIMessage) => ({
  inputTokens: message.usage_metadata?.input_tokens ?? 0,
  outputTokens: message.usage_metadata?.output_tokens ?? 0,
});

function fromReply(reply: AIMessage): ChatResult {
  const toolCalls: ToolCall[] = (reply.tool_calls ?? []).map((call, i) => ({
    id: call.id ?? `call_${i}`,
    name: call.name,
    args: call.args,
  }));
  const text = textOf(reply.content);
  return {
    text,
    toolCalls,
    assistantMessage: { role: 'assistant', content: text, toolCalls, providerMessage: reply },
    ...tokensOf(reply),
  };
}

export class LangChainChatModel implements ChatModel {
  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly create: ChatModelFactory,
    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  async generate(request: ChatRequest): Promise<ChatResult> {
    const messages = [new SystemMessage(request.system), ...request.messages.map(toLangChainMessage)];
    const model = this.create({ temperature: request.temperature, maxOutputTokens: request.maxOutputTokens });

    if (request.tools?.length) {
      const bound = model.bindTools(request.tools.map(toLangChainTool));
      return fromReply(await this.withRetries(request, (signal) => bound.invoke(messages, { signal })));
    }

    if (request.responseSchema) {
      const structured = model.withStructuredOutput(request.responseSchema, { includeRaw: true });
      const { raw, parsed } = await this.withRetries(request, (signal) => structured.invoke(messages, { signal }));
      // A reply that did not parse comes back as null: it must not become an answer
      if (parsed === null || parsed === undefined) throw new LlmInvalidResponseError(INVALID_REPLY);
      const text = JSON.stringify(parsed);
      return {
        text,
        toolCalls: [],
        assistantMessage: { role: 'assistant', content: text, toolCalls: [], providerMessage: raw },
        ...tokensOf(raw),
      };
    }

    return fromReply(await this.withRetries(request, (signal) => model.invoke(messages, { signal })));
  }

  // Same behavior for every provider: LangChain's own retries are off
  private async withRetries<T>(request: ChatRequest, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(this.policy.attemptTimeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      try {
        return await run(signal);
      } catch (error) {
        const status = statusOf(error);
        // No status means a network failure or a timeout, which can be transient
        const retryable = !request.signal?.aborted && (status === undefined || RETRYABLE_STATUSES.has(status));
        if (!retryable || attempt >= this.policy.maxAttempts) throw toLlmError(error);
        await this.policy.delay(attempt);
      }
    }
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd apps/api && pnpm test src/llm && pnpm exec tsc --noEmit && pnpm lint`
Expected: all `src/llm` tests pass (the adapter spec has 16 tests), `tsc` prints nothing, lint is clean.

If `tsc` complains about the LangChain types (the `schema` of `tool()` takes a zod schema or a JSON schema type, `block.text` is not on every content block type, and `args` is typed loosely), fix it with a narrow cast in `langchain-chat.adapter.ts`, not in the test, and note it as a ruling.

- [ ] **Step 10: Prove the timeout test is sensitive**

In `langchain-chat.adapter.ts`, temporarily change `attemptTimeoutMs: 20` usage by replacing `AbortSignal.timeout(this.policy.attemptTimeoutMs)` with `new AbortController().signal`. Run `pnpm test src/llm/langchain-chat` and confirm `cuts a call that hangs` times out and fails. Restore the line and run the tests again.

Expected: one failure with the mutation, all pass after restoring.

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat(api): add a LangChain chat adapter with retries, timeouts and error mapping"
```

**Checkpoint:** review the port and the adapter before continuing. Plan 5 builds on them.

---

### Task 3: OpenAI embeddings

**Files:**
- Create: `apps/api/src/llm/openai-embedding.adapter.ts`, `apps/api/src/llm/openai-embedding.adapter.spec.ts`

**Interfaces:**
- Consumes: `EmbeddingModel` from `llm.ports.ts`; `EMBEDDING_DIMENSIONS` from `../database/schema.js`; `toLlmError` from Task 2; `LlmInvalidResponseError`.
- Produces: `OpenAiEmbeddingModel implements EmbeddingModel`, constructed as `new OpenAiEmbeddingModel(client, modelName)` where `client` has `embedDocuments(texts)` and `embedQuery(text)` (an `OpenAIEmbeddings` instance in production).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/llm/openai-embedding.adapter.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm test src/llm/openai-embedding`
Expected: FAIL, `Cannot find module './openai-embedding.adapter.js'`.

- [ ] **Step 3: Create `apps/api/src/llm/openai-embedding.adapter.ts`**

```ts
import { EMBEDDING_DIMENSIONS } from '../database/schema.js';
import { LlmInvalidResponseError } from './llm.errors.js';
import type { EmbeddingModel } from './llm.ports.js';
import { toLlmError } from './provider-error.js';

// The slice of LangChain's OpenAIEmbeddings that this adapter uses
interface EmbeddingsClient {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

const INVALID_RESPONSE = 'The embedding response did not match the request';

export class OpenAiEmbeddingModel implements EmbeddingModel {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly client: EmbeddingsClient,
    readonly model: string,
  ) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors = await this.call(() => this.client.embedDocuments(texts));
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new LlmInvalidResponseError(INVALID_RESPONSE);
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vector = await this.call(() => this.client.embedQuery(text));
    if (vector.length !== this.dimensions) throw new LlmInvalidResponseError(INVALID_RESPONSE);
    return vector;
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toLlmError(error);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && pnpm test src/llm && pnpm exec tsc --noEmit && pnpm lint`
Expected: all `src/llm` tests pass, `tsc` and lint are clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add an OpenAI embedding adapter that checks the vector dimension"
```

---

### Task 4: Configuration and provider wiring

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`
- Modify: `apps/api/src/llm/llm.module.ts`
- Create: `apps/api/src/llm/llm.module.spec.ts`
- Modify: `apps/api/src/llm/gemini.adapter.ts`, `apps/api/src/llm/gemini.adapter.spec.ts` (remove the chat model)
- Modify: `apps/api/src/questions/questions.service.ts`, `apps/api/src/questions/questions.service.spec.ts`

**Interfaces:**
- Consumes: `LangChainChatModel`, `ChatModelFactory`, `LangChainChat` (Task 2), `OpenAiEmbeddingModel` (Task 3), `GeminiEmbeddingModel`, `GEMINI_HTTP_OPTIONS`.
- Produces:
  - `Env` gains `LLM_PROVIDER: 'gemini' | 'openai' | 'anthropic' | 'mock'`, `EMBEDDING_PROVIDER: 'gemini' | 'openai' | 'mock'` (resolved, never undefined), `OPENAI_API_KEY?`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `ANTHROPIC_API_KEY?`, `ANTHROPIC_CHAT_MODEL`, `LLM_TEMPERATURE: number | null`.
  - `createModels(config): { chat: ChatModel; embedding: EmbeddingModel }` exported from `llm.module.ts`.

- [ ] **Step 1: Write the failing configuration tests**

In `apps/api/src/config/env.spec.ts`, add before the test `'rejects an unknown provider'`:

```ts
  it('lets chat use OpenAI or Anthropic, with the documented default models', () => {
    const openai = validateEnv({ ...base, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
    expect(openai.OPENAI_CHAT_MODEL).toBe('gpt-4o-mini');
    expect(openai.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(openai.EMBEDDING_PROVIDER).toBe('openai');

    const anthropic = validateEnv({
      ...base,
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      EMBEDDING_PROVIDER: 'mock',
    });
    expect(anthropic.ANTHROPIC_CHAT_MODEL).toBe('claude-haiku-4-5');
    expect(anthropic.EMBEDDING_PROVIDER).toBe('mock');
  });

  it('follows the chat provider for embeddings unless told otherwise', () => {
    expect(validateEnv(base).EMBEDDING_PROVIDER).toBe('mock');
    const mixed = validateEnv({
      ...base,
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      EMBEDDING_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
    });
    expect(mixed.EMBEDDING_PROVIDER).toBe('gemini');
  });

  it('requires the key of every provider that is in use, and names the setting', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'anthropic', EMBEDDING_PROVIDER: 'mock' })).toThrow(/ANTHROPIC_API_KEY/);
    // Chat on the mock, embeddings on OpenAI: the embedding provider needs its key too
    expect(() => validateEnv({ ...base, EMBEDDING_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ ...base, EMBEDDING_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
  });

  it('refuses Anthropic without an embedding provider, because Anthropic has no embedding model', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' })).toThrow(
      /EMBEDDING_PROVIDER/,
    );
  });

  it('defaults the temperature to 0.2, reads a number, and treats empty as not sent', () => {
    expect(validateEnv(base).LLM_TEMPERATURE).toBe(0.2);
    expect(validateEnv({ ...base, LLM_TEMPERATURE: '0.5' }).LLM_TEMPERATURE).toBe(0.5);
    expect(validateEnv({ ...base, LLM_TEMPERATURE: '' }).LLM_TEMPERATURE).toBeNull();
    expect(() => validateEnv({ ...base, LLM_TEMPERATURE: '1.5' })).toThrow(/LLM_TEMPERATURE/);
    expect(() => validateEnv({ ...base, LLM_TEMPERATURE: 'hot' })).toThrow(/LLM_TEMPERATURE/);
  });
```

Also, in the existing test `'rejects an unknown provider'`, keep it as is (it uses `openai`, which is now valid): replace its body with:

```ts
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'cohere' })).toThrow(/LLM_PROVIDER/);
    expect(() => validateEnv({ ...base, EMBEDDING_PROVIDER: 'anthropic' })).toThrow(/EMBEDDING_PROVIDER/);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm test src/config`
Expected: FAIL in the new tests (`OPENAI_CHAT_MODEL` is undefined and `openai` is not an allowed provider).

- [ ] **Step 3: Update `apps/api/src/config/env.ts`**

Replace the `LLM_PROVIDER`/`GEMINI_*` lines of the schema (the block from `LLM_PROVIDER:` through `PROMPT_VERSION:`) with:

```ts
    LLM_PROVIDER: z.enum(['gemini', 'openai', 'anthropic', 'mock']).default('gemini'),
    // Defaults to the chat provider; required when that is Anthropic, which has no embedding model
    EMBEDDING_PROVIDER: optional(z.enum(['gemini', 'openai', 'mock'])),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_CHAT_MODEL: z.string().default('gemini-3.1-flash-lite'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
    OPENAI_API_KEY: optional(z.string()),
    OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    ANTHROPIC_API_KEY: optional(z.string()),
    ANTHROPIC_CHAT_MODEL: z.string().default('claude-haiku-4-5'),
    LLM_TEMPERATURE: temperature,
    PROMPT_VERSION: z.string().default('qa-v1'),
```

Add this helper below the `optional` helper:

```ts
// Empty means "do not send it": models that reason reject a temperature other than their own
const temperature = z.preprocess(
  (value) => (value === undefined ? 0.2 : value === '' ? null : value),
  z.union([z.null(), z.coerce.number().min(0).max(1)]),
);

type Draft = { LLM_PROVIDER: string; EMBEDDING_PROVIDER?: string };
const usesProvider = (env: Draft, provider: string) =>
  env.LLM_PROVIDER === provider || (env.EMBEDDING_PROVIDER ?? env.LLM_PROVIDER) === provider;
```

Replace the existing first `.refine(...)` (the one that requires `GEMINI_API_KEY`) with:

```ts
  .refine((env) => !(env.LLM_PROVIDER === 'anthropic' && !env.EMBEDDING_PROVIDER), {
    message: 'EMBEDDING_PROVIDER is required when LLM_PROVIDER is anthropic, because Anthropic has no embedding model',
    path: ['EMBEDDING_PROVIDER'],
  })
  .refine((env) => !usesProvider(env, 'gemini') || !!env.GEMINI_API_KEY, {
    message: 'GEMINI_API_KEY is required when Gemini is used for chat or embeddings',
    path: ['GEMINI_API_KEY'],
  })
  .refine((env) => !usesProvider(env, 'openai') || !!env.OPENAI_API_KEY, {
    message: 'OPENAI_API_KEY is required when OpenAI is used for chat or embeddings',
    path: ['OPENAI_API_KEY'],
  })
  .refine((env) => env.LLM_PROVIDER !== 'anthropic' || !!env.ANTHROPIC_API_KEY, {
    message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic',
    path: ['ANTHROPIC_API_KEY'],
  })
```

Keep the demo-user `.refine(...)` as the last refine, and append after it:

```ts
  // The refinements above guarantee that the embedding provider is known by now
  .transform((env) => ({
    ...env,
    EMBEDDING_PROVIDER: (env.EMBEDDING_PROVIDER ?? env.LLM_PROVIDER) as 'gemini' | 'openai' | 'mock',
  }));
```

(Remove the `;` that ended the last refine.)

- [ ] **Step 4: Run them to verify they pass**

Run: `cd apps/api && pnpm test src/config && pnpm exec tsc --noEmit`
Expected: PASS, and `tsc` prints nothing. If `tsc` reports that `Env` is not what the rest of the code expects, `Env` is now the output of the transform: check that `export type Env = z.infer<typeof envSchema>` is still the last type line.

- [ ] **Step 5: Write the failing test for the provider wiring**

Create `apps/api/src/llm/llm.module.spec.ts`:

```ts
import type { ConfigService } from '@nestjs/config';
import { type Env, validateEnv } from '../config/env.js';
import { GeminiEmbeddingModel } from './gemini.adapter.js';
import { LangChainChatModel } from './langchain-chat.adapter.js';
import { createModels } from './llm.module.js';
import { MockChatModel, MockEmbeddingModel } from './mock.adapter.js';
import { OpenAiEmbeddingModel } from './openai-embedding.adapter.js';

const base = { JWT_SECRET: 'x'.repeat(32) };

function modelsFor(raw: Record<string, string>) {
  const env = validateEnv({ ...base, ...raw });
  const config = { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
  return createModels(config);
}

describe('createModels', () => {
  it('builds the offline models', () => {
    const { chat, embedding } = modelsFor({ LLM_PROVIDER: 'mock' });
    expect(chat).toBeInstanceOf(MockChatModel);
    expect(embedding).toBeInstanceOf(MockEmbeddingModel);
  });

  it('builds Gemini chat through LangChain and Gemini embeddings through the native client', () => {
    const { chat, embedding } = modelsFor({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'key' });
    expect(chat).toBeInstanceOf(LangChainChatModel);
    expect(chat).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
    expect(embedding).toBeInstanceOf(GeminiEmbeddingModel);
    expect(embedding.model).toBe('gemini-embedding-001');
  });

  it('builds OpenAI for chat and embeddings', () => {
    const { chat, embedding } = modelsFor({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
    expect(chat).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(embedding).toBeInstanceOf(OpenAiEmbeddingModel);
    expect(embedding.model).toBe('text-embedding-3-small');
  });

  it('builds Anthropic chat with the embeddings of another provider', () => {
    const { chat, embedding } = modelsFor({
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      EMBEDDING_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
    });
    expect(chat).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(embedding).toBeInstanceOf(GeminiEmbeddingModel);
  });

  it('takes the model names from the settings', () => {
    const { chat, embedding } = modelsFor({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_CHAT_MODEL: 'my-chat',
      OPENAI_EMBEDDING_MODEL: 'my-embedding',
    });
    expect(chat.model).toBe('my-chat');
    expect(embedding.model).toBe('my-embedding');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/api && pnpm test src/llm/llm.module`
Expected: FAIL, `createModels` is not exported from `llm.module.ts`.

- [ ] **Step 7: Replace `apps/api/src/llm/llm.module.ts`**

```ts
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { GoogleGenAI } from '@google/genai';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { EMBEDDING_DIMENSIONS } from '../database/schema.js';
import { GEMINI_HTTP_OPTIONS, GeminiEmbeddingModel } from './gemini.adapter.js';
import { type ChatModelFactory, type ChatModelOptions, type LangChainChat, LangChainChatModel } from './langchain-chat.adapter.js';
import { CHAT_MODEL, type ChatModel, EMBEDDING_MODEL, type EmbeddingModel } from './llm.ports.js';
import { MockChatModel, MockEmbeddingModel } from './mock.adapter.js';
import { OpenAiEmbeddingModel } from './openai-embedding.adapter.js';

const LLM_MODELS = Symbol('LLM_MODELS');
type LlmModels = { chat: ChatModel; embedding: EmbeddingModel };

// LangChain retries are off: the adapter owns retries so every provider behaves the same
const NO_RETRIES = 0;

// Only send the temperature when there is one: some models reject a value other than their own
const temperatureOf = ({ temperature }: ChatModelOptions) => (temperature === undefined ? {} : { temperature });

// The LangChain classes satisfy LangChainChat but declare wider types, so the cast is made once here
const asChat = (model: unknown) => model as LangChainChat;

function createChat(env: ConfigService<Env, true>): ChatModel {
  const get = <K extends keyof Env>(key: K) => env.get(key, { infer: true }) as Env[K];

  switch (get('LLM_PROVIDER')) {
    case 'mock':
      return new MockChatModel();
    case 'gemini': {
      const model = get('GEMINI_CHAT_MODEL');
      const apiKey = get('GEMINI_API_KEY');
      const create: ChatModelFactory = (options) =>
        asChat(new ChatGoogle({ model, apiKey, maxOutputTokens: options.maxOutputTokens, maxRetries: NO_RETRIES, ...temperatureOf(options) }));
      return new LangChainChatModel('gemini', model, create);
    }
    case 'openai': {
      const model = get('OPENAI_CHAT_MODEL');
      const apiKey = get('OPENAI_API_KEY');
      const create: ChatModelFactory = (options) =>
        asChat(new ChatOpenAI({ model, apiKey, maxTokens: options.maxOutputTokens, maxRetries: NO_RETRIES, ...temperatureOf(options) }));
      return new LangChainChatModel('openai', model, create);
    }
    case 'anthropic': {
      const model = get('ANTHROPIC_CHAT_MODEL');
      const apiKey = get('ANTHROPIC_API_KEY');
      const create: ChatModelFactory = (options) =>
        asChat(new ChatAnthropic({ model, apiKey, maxTokens: options.maxOutputTokens, maxRetries: NO_RETRIES, ...temperatureOf(options) }));
      return new LangChainChatModel('anthropic', model, create);
    }
  }
}

function createEmbedding(env: ConfigService<Env, true>): EmbeddingModel {
  const get = <K extends keyof Env>(key: K) => env.get(key, { infer: true }) as Env[K];

  switch (get('EMBEDDING_PROVIDER')) {
    case 'mock':
      return new MockEmbeddingModel();
    case 'gemini': {
      const client = new GoogleGenAI({ apiKey: get('GEMINI_API_KEY'), httpOptions: GEMINI_HTTP_OPTIONS });
      return new GeminiEmbeddingModel(client, get('GEMINI_EMBEDDING_MODEL'));
    }
    case 'openai': {
      const model = get('OPENAI_EMBEDDING_MODEL');
      const client = new OpenAIEmbeddings({
        model,
        apiKey: get('OPENAI_API_KEY'),
        dimensions: EMBEDDING_DIMENSIONS,
        maxRetries: 2,
        timeout: 30_000,
      });
      return new OpenAiEmbeddingModel(client, model);
    }
  }
}

// The only place that knows which provider is active. A new provider is one case in each function
export function createModels(config: ConfigService<Env, true>): LlmModels {
  return { chat: createChat(config), embedding: createEmbedding(config) };
}

@Global()
@Module({
  providers: [
    { provide: LLM_MODELS, inject: [ConfigService], useFactory: createModels },
    { provide: CHAT_MODEL, inject: [LLM_MODELS], useFactory: (models: LlmModels) => models.chat },
    { provide: EMBEDDING_MODEL, inject: [LLM_MODELS], useFactory: (models: LlmModels) => models.embedding },
  ],
  exports: [CHAT_MODEL, EMBEDDING_MODEL],
})
export class LlmModule {}
```

- [ ] **Step 8: Remove the bridge chat adapter**

In `apps/api/src/llm/gemini.adapter.ts`, delete the whole `GeminiChatModel` class, the `import { textResult } from './chat-result.js';` line, and the unused `ChatModel, ChatRequest, ChatResult` names from the `llm.ports` import (keep `EmbeddingModel`).

In `apps/api/src/llm/gemini.adapter.spec.ts`, delete the whole `describe('GeminiChatModel', ...)` block and remove `GeminiChatModel` from the import line.

- [ ] **Step 9: Move the temperature to configuration**

In `apps/api/src/questions/questions.service.ts`: delete the line `// Low temperature keeps answers close to the sources` and the `const TEMPERATURE = 0.2;` line below it. Add a field after `private readonly maxQuestionChars: number;`:

```ts
  // Low temperature keeps answers close to the sources; null means the provider's own default
  private readonly temperature: number | undefined;
```

In the constructor, after `this.maxQuestionChars = ...;`, add:

```ts
    this.temperature = config.get('LLM_TEMPERATURE', { infer: true }) ?? undefined;
```

In the `generate` call, replace `temperature: TEMPERATURE,` with `temperature: this.temperature,`.

In `apps/api/src/questions/questions.service.spec.ts`, add `LLM_TEMPERATURE: 0.2,` to the `settings` object, and add this test after `'rejects blank and oversized questions'`:

```ts
  it('sends no temperature when the setting is empty', async () => {
    settings.LLM_TEMPERATURE = null;
    try {
      const { service, generate } = setup();
      await service.ask('user-1', 'doc-1', 'What is the capital of France?');
      expect(generate.mock.calls[0][0].temperature).toBeUndefined();
    } finally {
      settings.LLM_TEMPERATURE = 0.2;
    }
  });
```

- [ ] **Step 10: Run everything**

Run: `cd apps/api && pnpm test && pnpm exec tsc --noEmit && pnpm lint && docker compose -f ../../docker-compose.yml up -d db && pnpm test:int`
Expected: all unit tests pass, `tsc` and lint are clean, and the 8 integration tests pass (they run with `LLM_PROVIDER=mock`).

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat(api): select Gemini, OpenAI, Anthropic or the mock for chat, and the embedding provider apart"
```

---

### Task 5: Documentation, settings and real verification

**Files:**
- Modify: `.env.example`, `README.md`
- Modify: `docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md`, `docs/superpowers/specs/2026-10-06-langchain-providers-and-agentic-mode-design.md`

**Interfaces:**
- Consumes: everything from tasks 1 to 4.
- Produces: documentation that matches the code, and evidence that the classic mode still answers correctly against real Gemini through LangChain.

- [ ] **Step 1: Update `.env.example`**

Replace the block from `# LLM provider:` through `PROMPT_VERSION=qa-v1` with:

```dotenv
# Chat provider: gemini, openai, anthropic or mock (offline, fake answers)
LLM_PROVIDER=gemini
# Embeddings: gemini, openai or mock. Defaults to the chat provider; required for anthropic
# EMBEDDING_PROVIDER=gemini

# Gemini (verified)
GEMINI_API_KEY=
GEMINI_CHAT_MODEL=gemini-3.1-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001

# OpenAI (wired, not verified against the real API)
# OPENAI_API_KEY=
# OPENAI_CHAT_MODEL=gpt-4o-mini
# OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Anthropic (wired, not verified). It has no embeddings, so set EMBEDDING_PROVIDER too
# ANTHROPIC_API_KEY=
# ANTHROPIC_CHAT_MODEL=claude-haiku-4-5

# Sampling temperature, 0 to 1. Leave it empty to not send one (models that reason reject it)
LLM_TEMPERATURE=0.2
PROMPT_VERSION=qa-v1
```

- [ ] **Step 2: Update the README**

In `README.md`:

1. In the table of modules, replace the `llm` row with:

```markdown
| `llm` | Ports for the chat and embedding models, one LangChain chat adapter for Gemini, OpenAI and Anthropic, and the offline mock |
```

2. Replace the whole "### Switching providers" section (from that heading up to the next `###` heading) with:

```markdown
### Switching providers

`LLM_PROVIDER` selects the chat model and `EMBEDDING_PROVIDER` the embedding model.
Both are plain settings: someone with an OpenAI or Anthropic key sets it in `.env` and
restarts the API.

| Provider | Chat | Embeddings | Status |
|---|---|---|---|
| `gemini` | `gemini-3.1-flash-lite` | `gemini-embedding-001` | Verified against the real API |
| `openai` | `gpt-4o-mini` | `text-embedding-3-small` | Wired and unit-tested, **not verified**: I have no key |
| `anthropic` | `claude-haiku-4-5` | none | Wired and unit-tested, **not verified**. Anthropic has no embedding model, so `EMBEDDING_PROVIDER` is required |
| `mock` | offline fake answers | offline fake vectors | Verified, needs no key |

Chat goes through LangChain: one adapter, `LangChainChatModel`, serves the three real
providers behind our own `ChatModel` port, so nothing outside `src/llm` knows LangChain.
The adapter owns retries (3 attempts, 30 seconds each), the per-attempt timeout, the
cancellation signal and the mapping of provider errors, so every provider behaves the
same. Adding a provider is one case in `src/llm/llm.module.ts`.

Chat and embeddings are two ports because the swaps are not equivalent. Changing the
chat model is free. Changing the embedding model means re-embedding every document,
since vectors from different models are not comparable. Each document records the
embedding model it was indexed with, and a question against a document indexed with a
different model is refused with a clear error. So when switching `EMBEDDING_PROVIDER`,
upload the documents again.

For Gemini I use `@langchain/google`, pinned to an exact version, instead of the older
`@langchain/google-genai`. I measured that the older package ignores both a timeout
and an abort signal, so a hung call could not be cut, and the newer one aborts at once.
The cost is that it is a 0.x release whose API may change.

`LLM_TEMPERATURE` defaults to 0.2. Leave it empty to send none: models that reason
reject a temperature other than their own.
```

3. In "## Trade-offs and known limitations", replace the row `| Own ports and adapters instead of LangChain | I maintain the chunker, retries and adapters |` with:

```markdown
| Own ports, with LangChain inside one adapter | A larger dependency surface, and a 0.x package for Gemini |
```

4. In the same section, add this bullet at the start of the known limitations list:

```markdown
- **Providers.** OpenAI and Anthropic are wired but not verified against their real
  APIs, because I have no keys. How each handles structured output, and whether a
  newer model accepts the parameters I send, is untested. Reasoning models may need
  `LLM_TEMPERATURE` left empty.
```

- [ ] **Step 3: Update the specs**

In `docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md`:

1. In the decisions table (section 13), replace the row that starts with `| Own ports and adapters | LangChain |` with:

```markdown
| Own ports, LangChain inside one chat adapter | LangChain throughout | The separation the brief asks for stays in our code, and one adapter serves three providers | A larger dependency surface; Gemini needs a 0.x package |
```

2. In section 9 (configuration), add these rows after `GEMINI_EMBEDDING_MODEL`:

```markdown
| `EMBEDDING_PROVIDER` | the chat provider | |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | none | Yes |
| `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `ANTHROPIC_CHAT_MODEL` | `gpt-4o-mini`, `text-embedding-3-small`, `claude-haiku-4-5` | |
| `LLM_TEMPERATURE` | `0.2` | |
```

In `docs/superpowers/specs/2026-10-06-langchain-providers-and-agentic-mode-design.md`, in section 4.2, replace the first sentence ("One class, `LangChainChatModel`, takes a LangChain chat model, a provider name and a model name.") with:

```markdown
One class, `LangChainChatModel`, takes a provider name, a model name and a factory that
builds the LangChain chat model for one request's temperature and output limit, because
each provider names those options differently. It also owns the retry policy.
```

and replace the line `4. Applies a per-attempt timeout of 30 seconds and up to 2 retries, as today, plus the request's \`signal\`.` with:

```markdown
4. Applies up to 3 attempts with a 30 second timeout each, plus the request's `signal`. LangChain's own retries are off, so attempts are not multiplied.
```

- [ ] **Step 4: Check the docs against the code**

Run:

```bash
grep -n "EMBEDDING_PROVIDER\|OPENAI_CHAT_MODEL\|ANTHROPIC_CHAT_MODEL\|LLM_TEMPERATURE" .env.example README.md | cut -c1-120
cd apps/api && grep -n "'gpt-4o-mini'\|'claude-haiku-4-5'\|'text-embedding-3-small'" src/config/env.ts
```

Expected: every setting named in the README and `.env.example` exists in `env.ts`, with the same default.

Then look for sentences that are now false:

```bash
grep -n "GeminiChatModel\|google/genai\|adapters" README.md docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md | cut -c1-150
```

Expected: no line says the Gemini chat adapter uses the Google SDK or lists the old adapters. Fix any that do, in the same commit.

- [ ] **Step 5: Verify the mock provider in Docker**

```bash
df -h /System/Volumes/Data | tail -1
docker compose up -d --build api
curl -s --retry 30 --retry-all-errors --retry-delay 2 localhost:3001/api/health; echo
TOKEN=$(curl -s -X POST localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"test@test.com","password":"test-password"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
ID=$(curl -s -X POST localhost:3001/api/documents -H "Authorization: Bearer $TOKEN" -F 'file=@./docs/CHALLENGE.md' | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -s -X POST localhost:3001/api/documents/$ID/questions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"question":"Which backend technologies are allowed?"}' | cut -c1-160; echo
```

Expected: `{"status":"ok"}`, then an answer with `"status":"answered"` and an answer text that starts with `[mock]`. This proves the image builds with the new packages and the classic flow runs through the new port.

- [ ] **Step 6: Verify the classic mode against real Gemini through LangChain**

This spends about 11 Gemini requests. Run from `apps/api` after `pnpm build`:

```bash
cd apps/api && pnpm build
PORT=3101 LLM_PROVIDER=gemini EMBEDDING_PROVIDER=gemini API_DOCS_ENABLED=false node --env-file=../../.env dist/main.js > "${TMPDIR:-/tmp}/api-plan4.log" 2>&1 & API_PID=$!
API=localhost:3101/api; J='Content-Type: application/json'
curl -s --retry 15 --retry-all-errors --retry-delay 1 -o /dev/null $API/health
TOKEN=$(curl -s -X POST $API/auth/login -H "$J" -d '{"email":"test@test.com","password":"test-password"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
DOC=$(curl -s -X POST $API/documents -H "Authorization: Bearer $TOKEN" -F 'file=@../../docs/CHALLENGE.md' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
for q in "Which backend technologies are allowed?" "What must the README cover?" "What does the brief say about prompt injection?" "Which bonus sections are listed?" "What is the time expectation?" "What is the CEO's name?"; do
  curl -s -X POST $API/documents/$DOC/questions -H "Authorization: Bearer $TOKEN" -H "$J" -d "{\"question\":\"$q\"}" \
    | node -pe 'const r=JSON.parse(require("fs").readFileSync(0)); r.status ? r.status + " in=" + r.usage.inputTokens + " out=" + r.usage.outputTokens + " | " + r.model : JSON.stringify(r).slice(0,160)'
  sleep 2
done
kill $API_PID
```

Expected: the first five lines start with `answered`, with input tokens between 1,100 and 1,500 and output tokens between 20 and 150 (earlier measurement: 1,262 and 58), the model shown is `gemini-3.1-flash-lite`, and the last line is `not_found`. If a line shows a 503 mentioning high demand, wait a minute and run that question again: it is provider load, not the adapter.

If the answers are `answered` but the token counts are far outside the range, record the difference in the ledger: LangChain may count thinking tokens differently from the native client.

- [ ] **Step 7: Run every suite and commit**

```bash
(cd apps/api && pnpm lint && pnpm test && pnpm test:int)
(cd apps/web && pnpm lint && pnpm typecheck && pnpm test)
git add .env.example README.md docs
git commit -m "docs: describe the provider settings and mark which providers are verified"
```

Expected: API unit and integration tests, and the 48 frontend tests, pass; lint and typecheck are clean.

**Checkpoint:** the branch can be merged on its own at this point. Decide whether to merge now or continue with plan 5.
