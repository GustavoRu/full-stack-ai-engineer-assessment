import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { DocumentRow, SourceType } from '../database/schema.js';
import { EMBEDDING_MODEL, type EmbeddingModel } from '../llm/llm.ports.js';
import { chunkText, normalizeText } from './chunker.js';
import { DocumentsRepository } from './documents.repository.js';
import { extractText, type IncomingFile } from './text-extractor.js';

export type CreateDocumentInput = { file?: IncomingFile; text?: string; title?: string };

const MAX_TITLE_LENGTH = 200;
const DEFAULT_TITLE_LENGTH = 60;

@Injectable()
export class DocumentsService {
  private readonly maxDocumentChars: number;

  constructor(
    private readonly repo: DocumentsRepository,
    @Inject(EMBEDDING_MODEL) private readonly embeddings: EmbeddingModel,
    config: ConfigService<Env, true>,
  ) {
    this.maxDocumentChars = config.get('MAX_DOCUMENT_CHARS', { infer: true });
  }

  async create(userId: string, input: CreateDocumentInput): Promise<DocumentRow> {
    const pastedText = input.text?.trim();
    if (!!input.file === !!pastedText) {
      throw new BadRequestException('Provide either a file or text, not both');
    }

    const source: { text: string; sourceType: SourceType } = input.file
      ? await extractText(input.file)
      : { text: pastedText ?? '', sourceType: 'pasted' };

    const text = normalizeText(source.text);
    if (text.length === 0) {
      throw new UnprocessableEntityException('No extractable text was found in the document');
    }
    if (text.length > this.maxDocumentChars) {
      throw new PayloadTooLargeException(
        `The document has ${text.length} characters and the limit is ${this.maxDocumentChars}`,
      );
    }

    // Embed before storing, so a failed embedding leaves nothing behind
    const textChunks = chunkText(text);
    const vectors = await this.embeddings.embedDocuments(textChunks.map((chunk) => chunk.content));

    const title = (input.title?.trim() || input.file?.originalname || text.slice(0, DEFAULT_TITLE_LENGTH).trim()).slice(
      0,
      MAX_TITLE_LENGTH,
    );

    return this.repo.createWithChunks(
      {
        userId,
        title,
        sourceType: source.sourceType,
        charCount: text.length,
        chunkCount: textChunks.length,
        embeddingModel: this.embeddings.model,
      },
      textChunks.map((chunk, i) => ({ chunkIndex: chunk.index, content: chunk.content, embedding: vectors[i] })),
    );
  }

  list(userId: string): Promise<DocumentRow[]> {
    return this.repo.listByUser(userId);
  }

  // 404 for both "missing" and "not yours", so existence is not leaked
  async get(id: string, userId: string): Promise<DocumentRow> {
    const document = await this.repo.findOwned(id, userId);
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  async remove(id: string, userId: string): Promise<void> {
    if (!(await this.repo.deleteOwned(id, userId))) {
      throw new NotFoundException('Document not found');
    }
  }
}
