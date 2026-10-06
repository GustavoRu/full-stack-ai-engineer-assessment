import { describeError } from './safe-exception.filter.js';

describe('describeError', () => {
  it('describes a database error without its message, which carries the SQL parameters', () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), {
      code: '23505',
      constraint: 'users_email_unique',
    });
    const error = Object.assign(
      new Error(
        'Failed query: insert into "users" ("email", "password_hash") values ($1, $2)\nparams: ada@example.com,$argon2id$v=19$secret-hash',
      ),
      { cause },
    );
    error.name = 'DrizzleQueryError';

    const line = JSON.stringify(describeError(error));

    expect(line).not.toContain('ada@example.com');
    expect(line).not.toContain('secret-hash');
    expect(JSON.parse(line)).toMatchObject({
      event: 'unhandled_error',
      type: 'DrizzleQueryError',
      dbCode: '23505',
      dbConstraint: 'users_email_unique',
    });
  });

  it('keeps stack frames, which locate the failure without exposing data', () => {
    const description = describeError(new TypeError('Cannot read properties of undefined (reading "text")'));
    expect(description.type).toBe('TypeError');
    expect(description.frames.length).toBeGreaterThan(0);
    expect(description.frames.every((frame) => frame.startsWith('at '))).toBe(true);
  });

  it('describes a thrown value that is not an Error', () => {
    expect(describeError('boom')).toEqual({ event: 'unhandled_error', type: 'string', frames: [] });
  });
});
