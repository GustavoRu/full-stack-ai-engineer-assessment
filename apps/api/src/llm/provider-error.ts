import { LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';

// Matches what the provider SDKs retry themselves, which includes Anthropic's 529 overloaded
export const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

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
