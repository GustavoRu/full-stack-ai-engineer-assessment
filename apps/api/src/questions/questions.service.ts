import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { removeNullBytes } from '../common/text.js';
import type { Env } from '../config/env.js';
import type { AnswerMode } from '../database/schema.js';
import { DocumentsService } from '../documents/documents.service.js';
import { CHAT_MODEL, type ChatModel, EMBEDDING_MODEL, type EmbeddingModel } from '../llm/llm.ports.js';
import { getAgentPromptTemplate, getPromptTemplate } from '../prompts/prompt.registry.js';
import type { AgentPromptTemplate, PromptTemplate } from '../prompts/prompt.types.js';
import { AGENT_DEADLINE_MS, type AgentUsage, runAgentLoop, type SearchStep } from './agent-loop.js';
import { type ParsedAnswer, parseAnswer, type RetrievedChunk } from './answer-parser.js';
import { type QuestionResponse, toQuestionResponse } from './question.response.js';
import { QuestionsRepository } from './questions.repository.js';

// What either answer mode produces, ready to be stored
type Outcome = { parsed: ParsedAnswer; passages: RetrievedChunk[]; searches: SearchStep[] };

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);
  private readonly template: PromptTemplate;
  private readonly agentTemplate: AgentPromptTemplate;
  private readonly defaultMode: AnswerMode;
  private readonly topK: number;
  private readonly agentTopK: number;
  private readonly agentMaxSearches: number;
  private readonly maxOutputTokens: number;
  private readonly maxQuestionChars: number;
  // Low temperature keeps answers close to the sources; null means the provider's own default
  private readonly temperature: number | undefined;

  constructor(
    private readonly repo: QuestionsRepository,
    private readonly documents: DocumentsService,
    @Inject(CHAT_MODEL) private readonly chat: ChatModel,
    @Inject(EMBEDDING_MODEL) private readonly embeddings: EmbeddingModel,
    config: ConfigService<Env, true>,
  ) {
    // Resolved at startup, so an unknown prompt version stops the app from booting
    this.template = getPromptTemplate(config.get('PROMPT_VERSION', { infer: true }));
    this.agentTemplate = getAgentPromptTemplate(config.get('AGENT_PROMPT_VERSION', { infer: true }));
    this.defaultMode = config.get('DEFAULT_ANSWER_MODE', { infer: true });
    this.topK = config.get('RETRIEVAL_TOP_K', { infer: true });
    this.agentTopK = config.get('AGENT_TOP_K', { infer: true });
    this.agentMaxSearches = config.get('AGENT_MAX_SEARCHES', { infer: true });
    this.maxOutputTokens = config.get('MAX_OUTPUT_TOKENS', { infer: true });
    this.maxQuestionChars = config.get('MAX_QUESTION_CHARS', { infer: true });
    this.temperature = config.get('LLM_TEMPERATURE', { infer: true }) ?? undefined;
  }

  async ask(
    userId: string,
    documentId: string,
    rawQuestion: string,
    mode: AnswerMode = this.defaultMode,
  ): Promise<QuestionResponse> {
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
    const promptVersion = mode === 'agentic' ? this.agentTemplate.version : this.template.version;
    // Filled in as the model is called, so a failure can still report what was spent
    const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };
    try {
      const outcome =
        mode === 'agentic'
          ? await this.answerAgentic(documentId, question, usage)
          : await this.answerClassic(documentId, question, usage);
      const latencyMs = Date.now() - startedAt;

      // Store the audit record
      const saved = await this.repo.create({
        documentId,
        userId,
        question,
        answer: outcome.parsed.answer,
        status: outcome.parsed.status,
        citations: outcome.parsed.citations,
        retrieved: outcome.passages.map(({ chunkIndex, distance }) => ({ chunkIndex, distance })),
        promptVersion,
        provider: this.chat.provider,
        model: this.chat.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
        mode,
        searches: outcome.searches,
        modelCalls: usage.modelCalls,
      });

      this.logger.log({
        event: 'question_answered',
        ...this.callMetadata(userId, documentId, mode, promptVersion),
        questionId: saved.id,
        status: saved.status,
        inputTokens: saved.inputTokens,
        outputTokens: saved.outputTokens,
        modelCalls: saved.modelCalls,
        searchCount: outcome.searches.length,
        latencyMs,
      });

      return toQuestionResponse(saved, new Map(outcome.passages.map((chunk) => [chunk.chunkIndex, chunk.content])));
    } catch (error) {
      // Token counts are present when the model was billed before the failure
      const billed = usage.modelCalls > 0;
      this.logger.warn({
        event: 'question_failed',
        ...this.callMetadata(userId, documentId, mode, promptVersion),
        error: error instanceof Error ? error.name : 'unknown',
        inputTokens: billed ? usage.inputTokens : undefined,
        outputTokens: billed ? usage.outputTokens : undefined,
        modelCalls: usage.modelCalls,
        latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  // Retrieve the nearest passages, build the prompt, call the model once, parse
  private async answerClassic(documentId: string, question: string, usage: AgentUsage): Promise<Outcome> {
    const queryEmbedding = await this.embeddings.embedQuery(question);
    const retrieved = await this.repo.findNearestChunks(documentId, queryEmbedding, this.topK);

    const prompt = this.template.build(
      question,
      retrieved.map((chunk, i) => ({ number: i + 1, content: chunk.content })),
    );

    const result = await this.chat.generate({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      responseSchema: prompt.responseSchema,
      temperature: this.temperature,
      maxOutputTokens: this.maxOutputTokens,
    });
    usage.modelCalls = 1;
    usage.inputTokens = result.inputTokens;
    usage.outputTokens = result.outputTokens;

    return { parsed: parseAnswer(result.text, retrieved), passages: retrieved, searches: [] };
  }

  // The model decides what to search for; the document is fixed here, by the request
  private answerAgentic(documentId: string, question: string, usage: AgentUsage): Promise<Outcome> {
    const search = async (query: string) => {
      const embedding = await this.embeddings.embedQuery(query);
      return this.repo.findNearestChunks(documentId, embedding, this.agentTopK);
    };
    return runAgentLoop(
      {
        question,
        template: this.agentTemplate,
        chat: this.chat,
        search,
        maxSearches: this.agentMaxSearches,
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
        deadlineMs: AGENT_DEADLINE_MS,
      },
      usage,
    );
  }

  // Metadata only: never the question, the answer, the searches or document text
  private callMetadata(userId: string, documentId: string, mode: AnswerMode, promptVersion: string) {
    return {
      userId,
      documentId,
      provider: this.chat.provider,
      model: this.chat.model,
      promptVersion,
      mode,
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
