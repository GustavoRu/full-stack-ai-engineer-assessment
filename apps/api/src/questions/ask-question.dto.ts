import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AskQuestionDto {
  @ApiProperty({ example: 'What does the document say about termination?' })
  @IsString()
  @IsNotEmpty()
  question: string;
}
