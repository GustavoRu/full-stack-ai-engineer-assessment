import { type ArgumentsHost, Catch, type HttpServer, Logger } from '@nestjs/common';
import { type AbstractHttpAdapter, BaseExceptionFilter } from '@nestjs/core';

export type ErrorDescription = {
  event: 'unhandled_error';
  type: string;
  dbCode?: string;
  dbConstraint?: string;
  frames: string[];
};

const MAX_FRAMES = 5;

// Leaves out the message on purpose: a failed query's message carries the bound parameters
export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof Error)) {
    return { event: 'unhandled_error', type: typeof error, frames: [] };
  }
  const cause = error.cause as { code?: unknown; constraint?: unknown } | undefined;
  return {
    event: 'unhandled_error',
    type: error.name,
    ...(typeof cause?.code === 'string' && { dbCode: cause.code }),
    ...(typeof cause?.constraint === 'string' && { dbConstraint: cause.constraint }),
    frames: (error.stack ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at '))
      .slice(0, MAX_FRAMES),
  };
}

// Keeps Nest's default responses and replaces only how unexpected errors are logged
@Catch()
export class SafeExceptionFilter extends BaseExceptionFilter {
  private readonly safeLogger = new Logger(SafeExceptionFilter.name);

  override handleUnknownError(
    exception: unknown,
    host: ArgumentsHost,
    applicationRef: AbstractHttpAdapter | HttpServer,
  ): void {
    const body = this.isHttpError(exception)
      ? { statusCode: exception.statusCode, message: exception.message }
      : { statusCode: 500, message: 'Internal server error' };

    const response = host.getArgByIndex(1);
    if (applicationRef.isHeadersSent(response)) {
      applicationRef.end(response);
    } else {
      applicationRef.reply(response, body, body.statusCode);
    }

    // Client mistakes such as a malformed body are not worth an error line
    if (body.statusCode >= 500) {
      this.safeLogger.error(describeError(exception));
    }
  }
}
