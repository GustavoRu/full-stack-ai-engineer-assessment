// Provider-neutral failures, so no caller depends on a vendor SDK error type

export class LlmRateLimitError extends Error {
  override readonly name = 'LlmRateLimitError';
}

export class LlmUnavailableError extends Error {
  override readonly name = 'LlmUnavailableError';
}

export class LlmInvalidResponseError extends Error {
  override readonly name = 'LlmInvalidResponseError';
}
