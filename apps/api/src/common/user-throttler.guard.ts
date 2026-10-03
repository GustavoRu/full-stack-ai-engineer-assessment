import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  // Authenticated requests are limited per user, anonymous ones per IP
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ?? req.ip;
  }
}
