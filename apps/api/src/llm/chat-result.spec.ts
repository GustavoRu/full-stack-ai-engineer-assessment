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
