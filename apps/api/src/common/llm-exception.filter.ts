import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { LlmInvalidResponseError, LlmRateLimitError, LlmUnavailableError } from '../llm/llm.errors.js';
import { statusOf } from '../llm/provider-error.js';

type HttpErrorBody = { statusCode: number; message: string; error: string };

export function toHttpError(error: Error): HttpErrorBody {
  if (error instanceof LlmRateLimitError) {
    return { statusCode: 429, message: error.message, error: 'Too Many Requests' };
  }
  if (error instanceof LlmInvalidResponseError) {
    return { statusCode: 502, message: error.message, error: 'Bad Gateway' };
  }
  return { statusCode: 503, message: error.message, error: 'Service Unavailable' };
}

@Catch(LlmRateLimitError, LlmUnavailableError, LlmInvalidResponseError)
export class LlmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(LlmExceptionFilter.name);

  catch(error: Error, host: ArgumentsHost) {
    const body = toHttpError(error);
    const providerStatus = statusOf(error.cause);
    // Metadata only: provider messages could echo user content
    this.logger.warn({ event: 'llm_error', type: error.name, statusCode: body.statusCode, providerStatus });
    host.switchToHttp().getResponse().status(body.statusCode).json(body);
  }
}
