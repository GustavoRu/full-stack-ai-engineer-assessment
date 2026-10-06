import { ConflictException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { AuthService } from './auth.service.js';
import { DemoUserSeeder } from './demo-user.seeder.js';

function setup(env: Partial<Env>) {
  const register = vi.fn().mockResolvedValue({ accessToken: 'token' });
  const config = { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
  const seeder = new DemoUserSeeder(config, { register } as unknown as AuthService);
  return { register, seeder };
}

const demo = { DEMO_USER_EMAIL: 'test@test.com', DEMO_USER_PASSWORD: 'test-password' };

describe('DemoUserSeeder', () => {
  it('creates the demo user when both values are set', async () => {
    const { register, seeder } = setup(demo);
    await seeder.onApplicationBootstrap();
    expect(register).toHaveBeenCalledWith('test@test.com', 'test-password');
  });

  it('does nothing when no demo user is configured', async () => {
    const { register, seeder } = setup({});
    await seeder.onApplicationBootstrap();
    expect(register).not.toHaveBeenCalled();
  });

  it('leaves an existing demo user alone', async () => {
    const { register, seeder } = setup(demo);
    register.mockRejectedValueOnce(new ConflictException('Email already registered'));
    await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('does not hide other failures', async () => {
    const { register, seeder } = setup(demo);
    register.mockRejectedValueOnce(new Error('connection lost'));
    await expect(seeder.onApplicationBootstrap()).rejects.toThrow('connection lost');
  });

  it('logs the event without the address or the password', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { seeder } = setup(demo);
    await seeder.onApplicationBootstrap();
    const entry = JSON.stringify(log.mock.calls[0]?.[0]);
    log.mockRestore();
    expect(entry).toContain('demo_user_created');
    expect(entry).not.toContain('test@test.com');
    expect(entry).not.toContain('test-password');
  });
});
