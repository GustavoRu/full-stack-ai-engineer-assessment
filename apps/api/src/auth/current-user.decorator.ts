import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export type AuthUser = { id: string; email: string };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest().user,
);
