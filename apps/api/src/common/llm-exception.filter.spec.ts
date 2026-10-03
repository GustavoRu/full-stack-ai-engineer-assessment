import { LlmInvalidResponseError, LlmRateLimitError, LlmUnavailableError } from '../llm/llm.errors.js';
import { toHttpError } from './llm-exception.filter.js';

describe('toHttpError', () => {
  it('maps a provider quota error to 429', () => {
    expect(toHttpError(new LlmRateLimitError('quota'))).toEqual({
      statusCode: 429,
      message: 'quota',
      error: 'Too Many Requests',
    });
  });

  it('maps an invalid model response to 502', () => {
    expect(toHttpError(new LlmInvalidResponseError('bad output'))).toEqual({
      statusCode: 502,
      message: 'bad output',
      error: 'Bad Gateway',
    });
  });

  it('maps an unavailable provider to 503', () => {
    expect(toHttpError(new LlmUnavailableError('down'))).toEqual({
      statusCode: 503,
      message: 'down',
      error: 'Service Unavailable',
    });
  });
});
