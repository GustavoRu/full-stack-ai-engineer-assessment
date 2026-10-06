import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { QuestionsController } from './questions.controller.js';
import { QuestionsRepository } from './questions.repository.js';
import { QuestionsService } from './questions.service.js';

@Module({
  imports: [DocumentsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService, QuestionsRepository],
})
export class QuestionsModule {}
