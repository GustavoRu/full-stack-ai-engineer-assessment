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
