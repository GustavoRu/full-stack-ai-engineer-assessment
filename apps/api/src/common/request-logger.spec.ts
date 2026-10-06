import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { requestLogger } from './request-logger.js';

type FakeRequest = { method: string; originalUrl: string; user?: { id: string }; headers?: Record<string, string>; body?: unknown };

// Runs one request through the middleware and returns what was logged
function handle(request: FakeRequest, statusCode: number) {
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  const response = Object.assign(new EventEmitter(), { statusCode });
  const next = vi.fn();
  requestLogger()(request as never, response as never, next);
  response.emit('finish');

  const result = { next, log: log.mock.calls, warn: warn.mock.calls };
  log.mockRestore();
  warn.mockRestore();
  return result;
}

describe('requestLogger', () => {
  it('logs the method, path, status, duration and user of a request', () => {
    const { next, log } = handle({ method: 'POST', originalUrl: '/api/documents/d-1/questions', user: { id: 'user-1' } }, 201);

    const entry = log[0]?.[0] as { durationMs?: unknown };

    expect(next).toHaveBeenCalledOnce();
    expect(entry).toMatchObject({
      event: 'http_request',
      method: 'POST',
      path: '/api/documents/d-1/questions',
      status: 201,
      userId: 'user-1',
    });
    expect(typeof entry.durationMs).toBe('number');
  });

  it('logs a request without a user, such as a sign-in', () => {
    const { log } = handle({ method: 'POST', originalUrl: '/api/auth/login' }, 401);
    expect(log[0]?.[0]).toMatchObject({ event: 'http_request', path: '/api/auth/login', status: 401 });
    expect(log[0]?.[0]).not.toHaveProperty('userId', expect.anything());
  });

  it('keeps the query string, headers and body out of the log', () => {
    const { log } = handle(
      {
        method: 'POST',
        originalUrl: '/api/auth/login?token=secret-token',
        headers: { authorization: 'Bearer secret-jwt' },
        body: { email: 'ada@example.com', password: 'secret-password' },
      },
      200,
    );

    const entry = JSON.stringify(log[0]?.[0]);
    expect(entry).toContain('/api/auth/login');
    expect(entry).not.toMatch(/secret|ada@example\.com/);
  });

  it('logs server errors as warnings', () => {
    const { log, warn } = handle({ method: 'GET', originalUrl: '/api/documents' }, 503);
    expect(log).toHaveLength(0);
    expect(warn[0]?.[0]).toMatchObject({ event: 'http_request', status: 503 });
  });

  it('does not log health checks', () => {
    const { next, log, warn } = handle({ method: 'GET', originalUrl: '/api/health' }, 200);
    expect(next).toHaveBeenCalledOnce();
    expect(log).toHaveLength(0);
    expect(warn).toHaveLength(0);
  });
});
