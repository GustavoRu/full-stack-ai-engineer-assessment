import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { removeNullBytes } from '../common/text.js';
import type { Env } from '../config/env.js';
import { DocumentsService } from '../documents/documents.service.js';
import {
  CHAT_MODEL,
  type ChatModel,
  type ChatResult,
  EMBEDDING_MODEL,
  type EmbeddingModel,
} from '../llm/llm.ports.js';
import { getPromptTemplate } from '../prompts/prompt.registry.js';
import type { PromptTemplate } from '../prompts/prompt.types.js';
import { parseAnswer } from './answer-parser.js';
import { type QuestionResponse, toQuestionResponse } from './question.response.js';
import { QuestionsRepository } from './questions.repository.js';

// Low temperature keeps answers close to the sources
const TEMPERATURE = 0.2;

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);
  private readonly template: PromptTemplate;
  private readonly topK: number;
  private readonly maxOutputTokens: number;
  private readonly maxQuestionChars: number;

  constructor(
    private readonly repo: QuestionsRepository,
    private readonly documents: DocumentsService,
    @Inject(CHAT_MODEL) private readonly chat: ChatModel,
    @Inject(EMBEDDING_MODEL) private readonly embeddings: EmbeddingModel,
    config: ConfigService<Env, true>,
  ) {
    // Resolved at startup, so an unknown PROMPT_VERSION stops the app from booting
    this.template = getPromptTemplate(config.get('PROMPT_VERSION', { infer: true }));
    this.topK = config.get('RETRIEVAL_TOP_K', { infer: true });
    this.maxOutputTokens = config.get('MAX_OUTPUT_TOKENS', { infer: true });
    this.maxQuestionChars = config.get('MAX_QUESTION_CHARS', { infer: true });
  }

  async ask(userId: string, documentId: string, rawQuestion: string): Promise<QuestionResponse> {
    const question = removeNullBytes(rawQuestion).trim();
    if (question.length === 0) {
      throw new BadRequestException('The question is empty');
    }
    if (question.length > this.maxQuestionChars) {
      throw new BadRequestException(`The question is longer than ${this.maxQuestionChars} characters`);
    }

    const document = await this.documents.get(documentId, userId);
    if (document.embeddingModel !== this.embeddings.model) {
      throw new ConflictException('This document was indexed with a different embedding model. Upload it again.');
    }

    const startedAt = Date.now();
    let result: ChatResult | undefined;
    try {
      // 1. Retrieve
      const queryEmbedding = await this.embeddings.embedQuery(question);
      const retrieved = await this.repo.findNearestChunks(documentId, queryEmbedding, this.topK);

      // 2. Build the prompt
      const prompt = this.template.build(
        question,
        retrieved.map((chunk, i) => ({ number: i + 1, content: chunk.content })),
      );

      // 3. Invoke the model
      result = await this.chat.generate({
        system: prompt.system,
        user: prompt.user,
        responseSchema: prompt.responseSchema,
        temperature: TEMPERATURE,
        maxOutputTokens: this.maxOutputTokens,
      });

      // 4. Post-process
      const parsed = parseAnswer(result.text, retrieved);
      const latencyMs = Date.now() - startedAt;

      // 5. Store the audit record
      const saved = await this.repo.create({
        documentId,
        userId,
        question,
        answer: parsed.answer,
        status: parsed.status,
        citations: parsed.citations,
        retrieved: retrieved.map(({ chunkIndex, distance }) => ({ chunkIndex, distance })),
        promptVersion: prompt.version,
        provider: this.chat.provider,
        model: this.chat.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs,
      });

      this.logger.log(
        JSON.stringify({
          event: 'question_answered',
          ...this.callMetadata(userId, documentId),
          questionId: saved.id,
          status: saved.status,
          inputTokens: saved.inputTokens,
          outputTokens: saved.outputTokens,
          latencyMs,
        }),
      );

      return toQuestionResponse(saved, new Map(retrieved.map((chunk) => [chunk.chunkIndex, chunk.content])));
    } catch (error) {
      // Token counts are present when the model was billed before the failure
      this.logger.warn(
        JSON.stringify({
          event: 'question_failed',
          ...this.callMetadata(userId, documentId),
          error: error instanceof Error ? error.name : 'unknown',
          inputTokens: result?.inputTokens,
          outputTokens: result?.outputTokens,
          latencyMs: Date.now() - startedAt,
        }),
      );
      throw error;
    }
  }

  // Metadata only: never the question, the answer or document text
  private callMetadata(userId: string, documentId: string) {
    return {
      userId,
      documentId,
      provider: this.chat.provider,
      model: this.chat.model,
      promptVersion: this.template.version,
    };
  }

  async history(userId: string, documentId: string): Promise<QuestionResponse[]> {
    await this.documents.get(documentId, userId);
    const rows = await this.repo.listByDocument(documentId);
    const citedIndexes = [...new Set(rows.flatMap((row) => row.citations))];
    const contents = await this.repo.findChunkContents(documentId, citedIndexes);
    return rows.map((row) => toQuestionResponse(row, contents));
  }
}
