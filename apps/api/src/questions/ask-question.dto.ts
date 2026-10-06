import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { AnswerMode } from '../database/schema.js';

export class AskQuestionDto {
  @ApiProperty({ example: 'What does the document say about termination?' })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiPropertyOptional({
    enum: ['classic', 'agentic'],
    description: 'agentic lets the model search the document itself: slower and uses more tokens',
  })
  @IsOptional()
  @IsIn(['classic', 'agentic'])
  mode?: AnswerMode;
}
