import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  text?: string;
}
