import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRow } from '../database/schema.js';
import { AuthService } from './auth.service.js';
import type { UsersRepository } from './users.repository.js';

class FakeUsersRepository {
  readonly rows: UserRow[] = [];

  async findByEmail(email: string) {
    return this.rows.find((user) => user.email === email);
  }

  async create(email: string, passwordHash: string) {
    const user = { id: `user-${this.rows.length + 1}`, email, passwordHash, createdAt: new Date() };
    this.rows.push(user);
    return user;
  }
}

function setup() {
  const repo = new FakeUsersRepository();
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: 60 } });
  const service = new AuthService(repo as unknown as UsersRepository, jwt);
  return { repo, jwt, service };
}

describe('AuthService', () => {
  it('registers a user with a lowercase email and a hashed password', async () => {
    const { repo, jwt, service } = setup();
    const { accessToken } = await service.register('  Ada@Example.com ', 'correct-horse');

    expect(repo.rows[0].email).toBe('ada@example.com');
    expect(repo.rows[0].passwordHash).toMatch(/^\$argon2id\$/);
    expect(await jwt.verifyAsync(accessToken)).toMatchObject({ sub: 'user-1', email: 'ada@example.com' });
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { service } = setup();
    await service.register('ada@example.com', 'correct-horse');
    await expect(service.register('ADA@example.com', 'another-pass')).rejects.toThrow(ConflictException);
  });

  it('answers 409 when a concurrent registration wins the unique email constraint', async () => {
    const { repo, service } = setup();
    // The existence check passes for both requests; the database then rejects the second insert
    vi.spyOn(repo, 'create').mockRejectedValueOnce(
      Object.assign(new Error('Failed query'), { cause: { code: '23505', constraint: 'users_email_unique' } }),
    );
    await expect(service.register('ada@example.com', 'correct-horse')).rejects.toThrow(ConflictException);
  });

  it('does not hide other database failures as a conflict', async () => {
    const { repo, service } = setup();
    vi.spyOn(repo, 'create').mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.register('ada@example.com', 'correct-horse')).rejects.toThrow('connection lost');
  });

  it('logs in with the right password', async () => {
    const { jwt, service } = setup();
    await service.register('ada@example.com', 'correct-horse');
    const { accessToken } = await service.login('Ada@example.com', 'correct-horse');
    expect(await jwt.verifyAsync(accessToken)).toMatchObject({ sub: 'user-1' });
  });

  it('rejects a wrong password and an unknown email with the same error', async () => {
    const { service } = setup();
    await service.register('ada@example.com', 'correct-horse');
    await expect(service.login('ada@example.com', 'wrong-pass')).rejects.toThrow(UnauthorizedException);
    await expect(service.login('nobody@example.com', 'correct-horse')).rejects.toThrow('Invalid credentials');
  });
});
