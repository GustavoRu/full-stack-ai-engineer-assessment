import { ConflictException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class DemoUserSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoUserSeeder.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly auth: AuthService,
  ) {}

  async onApplicationBootstrap() {
    const email = this.config.get('DEMO_USER_EMAIL', { infer: true });
    const password = this.config.get('DEMO_USER_PASSWORD', { infer: true });
    if (!email || !password) return;

    try {
      await this.auth.register(email, password);
      this.logger.log({ event: 'demo_user_created' });
    } catch (error) {
      // It exists from an earlier start, or another instance created it a moment ago
      if (!(error instanceof ConflictException)) throw error;
    }
  }
}
