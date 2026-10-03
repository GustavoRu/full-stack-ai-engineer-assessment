import 'reflect-metadata';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

class TestController {}
const protectedHandler = () => undefined;
const publicHandler = () => undefined;
Reflect.defineMetadata(IS_PUBLIC_KEY, true, publicHandler);

const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: 60 } });
const guard = new JwtAuthGuard(jwt, new Reflector());

function contextFor(handler: () => undefined, authorization?: string) {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: authorization ? { authorization } : {},
  };
  const context = {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  it('lets public routes through without a token', async () => {
    await expect(guard.canActivate(contextFor(publicHandler).context)).resolves.toBe(true);
  });

  it('rejects a protected route without a token', async () => {
    await expect(guard.canActivate(contextFor(protectedHandler).context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a malformed or forged token', async () => {
    const forged = await new JwtService({ secret: 'other-secret' }).signAsync({ sub: 'u1', email: 'a@b.c' });
    await expect(guard.canActivate(contextFor(protectedHandler, 'Bearer nope').context)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(guard.canActivate(contextFor(protectedHandler, `Bearer ${forged}`).context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid token and attaches the user', async () => {
    const token = await jwt.signAsync({ sub: 'u1', email: 'a@b.c' });
    const { context, request } = contextFor(protectedHandler, `Bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u1', email: 'a@b.c' });
  });
});
