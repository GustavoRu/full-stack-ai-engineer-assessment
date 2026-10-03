import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { LlmExceptionFilter } from './common/llm-exception.filter.js';
import { UserThrottlerGuard } from './common/user-throttler.guard.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { HealthController } from './health/health.controller.js';
import { LlmModule } from './llm/llm.module.js';
import { QuestionsModule } from './questions/questions.module.js';

@Module({
  imports: [
    // Reads apps/api/.env or the root .env when running outside Docker
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../../.env'] }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] }),
    DatabaseModule,
    LlmModule,
    AuthModule,
    DocumentsModule,
    QuestionsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: the JWT guard sets request.user, which the throttler uses as its key
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_FILTER, useClass: LlmExceptionFilter },
  ],
})
export class AppModule {}
