import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { removeNullBytes } from '../common/text.js';
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
  private readonly logger = new Logger(DocumentsService.name);
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
    if (!input.file && !pastedText) {
      throw new BadRequestException('Provide a file or some text');
    }
    if (input.file && pastedText) {
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

    const textChunks = chunkText(text);
    // Metadata only: never the document text or its title
    const metadata = {
      userId,
      sourceType: source.sourceType,
      charCount: text.length,
      chunkCount: textChunks.length,
      embeddingModel: this.embeddings.model,
    };
    const startedAt = Date.now();

    // Embed before storing, so a failed embedding leaves nothing behind
    let vectors: number[][];
    try {
      vectors = await this.embeddings.embedDocuments(textChunks.map((chunk) => chunk.content));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'document_ingest_failed',
          ...metadata,
          error: error instanceof Error ? error.name : 'unknown',
          latencyMs: Date.now() - startedAt,
        }),
      );
      throw error;
    }

    const created = await this.repo.createWithChunks(
      { ...metadata, title: pickTitle(input, text) },
      textChunks.map((chunk, i) => ({ chunkIndex: chunk.index, content: chunk.content, embedding: vectors[i] })),
    );

    this.logger.log(
      JSON.stringify({
        event: 'document_ingested',
        ...metadata,
        documentId: created.id,
        latencyMs: Date.now() - startedAt,
      }),
    );
    return created;
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

// First non-empty option: the explicit title, the file name, the start of the text
function pickTitle(input: CreateDocumentInput, text: string): string {
  const candidates = [input.title, input.file?.originalname, text.slice(0, DEFAULT_TITLE_LENGTH)];
  const title = candidates.map((candidate) => removeNullBytes(candidate ?? '').trim()).find(Boolean);
  return (title ?? 'Untitled document').slice(0, MAX_TITLE_LENGTH);
}
