import { LlmInvalidResponseError, LlmRateLimitError, LlmUnavailableError } from '../llm/llm.errors.js';
import { Logger } from '@nestjs/common';
import { LlmExceptionFilter, toHttpError } from './llm-exception.filter.js';

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

describe('LlmExceptionFilter', () => {
  function run(error: Error) {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    new LlmExceptionFilter().catch(error, host as never);
    const entry = warn.mock.calls[0]?.[0];
    warn.mockRestore();
    return { entry, status };
  }

  it('logs the provider status whichever field the library puts it in', () => {
    for (const cause of [{ status: 429 }, { statusCode: 429 }, { response: { status: 429 } }]) {
      const { entry } = run(new LlmRateLimitError('quota', { cause }));
      expect(entry).toMatchObject({ event: 'llm_error', type: 'LlmRateLimitError', statusCode: 429, providerStatus: 429 });
    }
  });

  it('logs no provider status when the cause has none', () => {
    const { entry } = run(new LlmUnavailableError('down', { cause: new Error('socket hang up') }));
    expect(entry).toMatchObject({ event: 'llm_error', statusCode: 503 });
    expect((entry as { providerStatus?: number }).providerStatus).toBeUndefined();
  });
});
