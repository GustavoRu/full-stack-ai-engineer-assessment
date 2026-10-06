import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type AuthUser, CurrentUser } from '../auth/current-user.decorator.js';
import { AskQuestionDto } from './ask-question.dto.js';
import { QuestionsService } from './questions.service.js';

@ApiTags('questions')
@ApiBearerAuth()
@Controller('documents/:documentId/questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  // Stops one user from spending the provider quota alone; several users together can still exceed it
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  ask(
    @CurrentUser() user: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: AskQuestionDto,
  ) {
    return this.questions.ask(user.id, documentId, dto.question, dto.mode);
  }

  @Get()
  history(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.questions.history(user.id, documentId);
  }
}
