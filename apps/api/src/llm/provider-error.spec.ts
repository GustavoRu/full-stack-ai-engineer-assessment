import { LlmRateLimitError, LlmUnavailableError } from './llm.errors.js';
import { isRetryableStatus, statusOf, toLlmError } from './provider-error.js';

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

describe('isRetryableStatus', () => {
  it('retries timeouts, rate limits and every server error, including Anthropic 529', () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) expect(isRetryableStatus(status)).toBe(true);
  });

  it('does not retry the other client errors', () => {
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryableStatus(status)).toBe(false);
  });
});
