import { setTimeout as sleep } from 'node:timers/promises';
import { getRetryable } from '@langchain/core/errors';
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { LlmInvalidResponseError } from './llm.errors.js';
import type { ChatMessage, ChatModel, ChatRequest, ChatResult, ToolCall, ToolDefinition } from './llm.ports.js';
import { isRetryableStatus, statusOf, toLlmError } from './provider-error.js';

type InvokeOptions = { signal?: AbortSignal };

// How the library asks the provider for JSON: native JSON-schema output, or a forced function call
export type StructuredMethod = 'jsonSchema' | 'functionCalling';
type Invokable<T> = { invoke(messages: BaseMessage[], options?: InvokeOptions): Promise<T> };

// The slice of a LangChain chat model that this adapter uses
export interface LangChainChat extends Invokable<AIMessage> {
  bindTools(tools: ReturnType<typeof tool>[]): Invokable<AIMessage>;
  withStructuredOutput(
    schema: object,
    config: { includeRaw: true; method?: StructuredMethod },
  ): Invokable<{ raw: AIMessage; parsed: unknown }>;
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
    // Left to the library when undefined; Gemini needs jsonSchema to send the same request as before
    private readonly structuredMethod?: StructuredMethod,
  ) {}

  async generate(request: ChatRequest): Promise<ChatResult> {
    const messages = [new SystemMessage(request.system), ...request.messages.map(toLangChainMessage)];
    const model = this.create({ temperature: request.temperature, maxOutputTokens: request.maxOutputTokens });

    if (request.tools?.length) {
      const bound = model.bindTools(request.tools.map(toLangChainTool));
      return fromReply(await this.withRetries(request, (signal) => bound.invoke(messages, { signal })));
    }

    if (request.responseSchema) {
      const structured = model.withStructuredOutput(request.responseSchema, {
        includeRaw: true,
        ...(this.structuredMethod ? { method: this.structuredMethod } : {}),
      });
      const { raw, parsed } = await this.withRetries(request, (signal) => structured.invoke(messages, { signal }));
      // A reply that did not parse comes back as null: it must not become an answer
      if (parsed === null || parsed === undefined) throw new LlmInvalidResponseError(INVALID_REPLY);
      const text = JSON.stringify(parsed);
      return {
        text,
        toolCalls: [],
        // The raw message is not kept: with function calling it holds a tool call that nothing answers
        assistantMessage: { role: 'assistant', content: text, toolCalls: [] },
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
        // No status means a network failure or a timeout, which can be transient, unless the library
        // already knows the error is permanent (a blocked prompt, a bad key, a context overflow)
        const transient = status === undefined ? getRetryable(error) !== false : isRetryableStatus(status);
        const retryable = !request.signal?.aborted && transient;
        if (!retryable || attempt >= this.policy.maxAttempts) throw toLlmError(error);
        await this.policy.delay(attempt);
      }
    }
  }
}
