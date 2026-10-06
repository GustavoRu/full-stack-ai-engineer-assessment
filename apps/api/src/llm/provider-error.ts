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
