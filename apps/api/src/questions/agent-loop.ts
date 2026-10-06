import { LlmInvalidResponseError, LlmUnavailableError } from '../llm/llm.errors.js';
import type { ChatMessage, ChatModel, ChatResult, ToolCall } from '../llm/llm.ports.js';
import type { AgentPromptTemplate } from '../prompts/prompt.types.js';
import { type ParsedAnswer, parseAnswer, type RetrievedChunk } from './answer-parser.js';

export const AGENT_DEADLINE_MS = 120_000;

const MAX_QUERY_CHARS = 200;
const TOO_SLOW = 'The question took too long. Try again, or turn off document search to use the standard mode.';
const NO_ANSWER = 'The model did not give an answer. Try asking again.';

export interface SearchStep {
  query: string;
  chunkIndexes: number[];
}

// Filled in while the loop runs, so the caller can log what was spent even when the loop fails
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
}

export interface AgentInput {
  question: string;
  template: AgentPromptTemplate;
  chat: ChatModel;
  // Embeds the query and returns the nearest passages of the document being asked about
  search(query: string): Promise<RetrievedChunk[]>;
  maxSearches: number;
  temperature: number | undefined;
  maxOutputTokens: number;
  deadlineMs: number;
}

export interface AgentOutcome {
  parsed: ParsedAnswer;
  // Every passage sent to the model, in passage-number order
  passages: RetrievedChunk[];
  searches: SearchStep[];
}

const normalize = (query: string) => query.trim().toLowerCase().replace(/\s+/g, ' ');

// The model decides what to search for; everything else is decided here, not by the model
export async function runAgentLoop(input: AgentInput, usage: AgentUsage): Promise<AgentOutcome> {
  const { template, chat } = input;
  const signal = AbortSignal.timeout(input.deadlineMs);
  const passages: RetrievedChunk[] = [];
  const numberOf = new Map<number, number>();
  const searches: SearchStep[] = [];
  const seenQueries = new Set<string>();
  const messages: ChatMessage[] = [{ role: 'user', content: template.userMessage(input.question) }];
  // Every search attempt counts, including invalid and repeated ones
  let attempts = 0;

  async function runCall(call: ToolCall): Promise<string> {
    // Several searches of one turn run one after another: the deadline applies to each
    if (signal.aborted) throw new LlmUnavailableError(TOO_SLOW);
    if (call.name !== template.searchTool.name) {
      return `Unknown tool "${call.name}". Use ${template.searchTool.name} or ${template.submitTool.name}.`;
    }
    attempts += 1;
    if (attempts > input.maxSearches) {
      return `Search limit reached. Call ${template.submitTool.name} with your answer now.`;
    }
    const query = typeof call.args.query === 'string' ? call.args.query.trim() : '';
    if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
      return `Invalid arguments: "query" must be a string of 1 to ${MAX_QUERY_CHARS} characters.`;
    }
    const key = normalize(query);
    if (seenQueries.has(key)) {
      return 'You already searched for this. Use the passages you have, search for something different, or submit your answer.';
    }
    seenQueries.add(key);

    // The query is all the model controls: the document and the user are fixed by the caller
    const found = await input.search(query);
    const numbered = found.map((chunk) => {
      let number = numberOf.get(chunk.chunkIndex);
      if (number === undefined) {
        passages.push(chunk);
        number = passages.length;
        numberOf.set(chunk.chunkIndex, number);
      }
      return { number, content: chunk.content };
    });
    searches.push({ query, chunkIndexes: found.map((chunk) => chunk.chunkIndex) });
    return numbered.length === 0 ? 'No passages were found.' : template.formatPassages(numbered);
  }

  // At most maxSearches + 1 model calls, whatever the model does: the last turn can only submit
  for (let turn = 0; turn <= input.maxSearches; turn++) {
    if (signal.aborted) throw new LlmUnavailableError(TOO_SLOW);
    const lastTurn = turn === input.maxSearches;
    const canSearch = !lastTurn && attempts < input.maxSearches;
    const tools = canSearch ? [template.searchTool, template.submitTool] : [template.submitTool];

    let result: ChatResult;
    try {
      result = await chat.generate({
        system: template.system(input.maxSearches),
        messages,
        tools,
        // With one tool left, a model that is only asked to use it may still answer in plain text
        requireToolCall: !canSearch,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new LlmUnavailableError(TOO_SLOW, { cause: error });
      throw error;
    }
    usage.modelCalls += 1;
    usage.inputTokens += result.inputTokens;
    usage.outputTokens += result.outputTokens;
    messages.push(result.assistantMessage);

    if (result.toolCalls.length === 0) {
      const text = result.text.trim();
      if (text.length === 0) throw new LlmInvalidResponseError(NO_ANSWER);
      // Plain text cannot be tied to a passage
      return { parsed: { status: 'unverified', answer: text, citations: [] }, passages, searches };
    }

    const submission = result.toolCalls.find((call) => call.name === template.submitTool.name);
    if (submission) {
      return { parsed: parseAnswer(JSON.stringify(submission.args), passages), passages, searches };
    }

    // Nothing could answer a tool call made on the last turn, so it is not run
    if (lastTurn) {
      if (signal.aborted) throw new LlmUnavailableError(TOO_SLOW);
      throw new LlmInvalidResponseError(NO_ANSWER);
    }

    for (const call of result.toolCalls) {
      messages.push({ role: 'tool', toolCallId: call.id, content: await runCall(call) });
    }
  }

  // Unreachable: the last turn always returns or throws above
  throw new LlmInvalidResponseError(NO_ANSWER);
}
