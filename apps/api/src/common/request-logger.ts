import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

// Health checks run every few seconds and would bury the real traffic
const SILENT_PATHS = new Set(['/api/health']);

// One line per request with metadata only: never the query string, headers or body
export function requestLogger() {
  return (request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();

    response.on('finish', () => {
      const path = request.originalUrl.split('?')[0];
      if (SILENT_PATHS.has(path)) return;

      const entry = {
        event: 'http_request',
        method: request.method,
        path,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
        // Set by the auth guard for signed-in users
        userId: (request as Request & { user?: { id: string } }).user?.id,
      };
      if (response.statusCode >= 500) logger.warn(entry);
      else logger.log(entry);
    });

    next();
  };
}
