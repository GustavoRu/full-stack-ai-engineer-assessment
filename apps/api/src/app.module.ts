import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { QuestionsModule } from './questions/questions.module.js';
import { HealthController } from './health/health.controller.js';
import { LlmModule } from './llm/llm.module.js';

@Module({
  imports: [
    // Reads apps/api/.env or the root .env when running outside Docker
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../../.env'] }),
    DatabaseModule,
    LlmModule,
    AuthModule,
    DocumentsModule,
    QuestionsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
