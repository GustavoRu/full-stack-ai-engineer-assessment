import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../config/env.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [
    // No storage option means files stay in memory and are never written to disk
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_BYTES', { infer: true }), files: 1 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsRepository],
  exports: [DocumentsService],
})
export class DocumentsModule {}
