import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type AuthUser, CurrentUser } from '../auth/current-user.decorator.js';
import { CreateDocumentDto } from './create-document.dto.js';
import { toDocumentResponse } from './document.response.js';
import { DocumentsService } from './documents.service.js';
import { decodeFilename, type IncomingFile } from './text-extractor.js';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto, @UploadedFile() upload?: IncomingFile) {
    const file = upload && { originalname: decodeFilename(upload.originalname), buffer: upload.buffer };
    return toDocumentResponse(await this.documents.create(user.id, { file, text: dto.text, title: dto.title }));
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return (await this.documents.list(user.id)).map(toDocumentResponse);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toDocumentResponse(await this.documents.get(id, user.id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.documents.remove(id, user.id);
  }
}
