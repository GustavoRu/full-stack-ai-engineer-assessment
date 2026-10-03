import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/current-user.decorator.js';
import { AskQuestionDto } from './ask-question.dto.js';
import { QuestionsService } from './questions.service.js';

@Controller('documents/:documentId/questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  ask(
    @CurrentUser() user: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: AskQuestionDto,
  ) {
    return this.questions.ask(user.id, documentId, dto.question);
  }

  @Get()
  history(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.questions.history(user.id, documentId);
  }
}
