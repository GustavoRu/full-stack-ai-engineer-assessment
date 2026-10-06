import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { DocumentRow, NewQuestion, QuestionRow } from '../database/schema.js';
import type { DocumentsService } from '../documents/documents.service.js';
import { textResult } from '../llm/chat-result.js';
import { LlmInvalidResponseError } from '../llm/llm.errors.js';
import type { ChatModel, ChatRequest } from '../llm/llm.ports.js';
import { MockEmbeddingModel } from '../llm/mock.adapter.js';
import type { RetrievedChunk } from './answer-parser.js';
import type { QuestionsRepository } from './questions.repository.js';
import { QuestionsService } from './questions.service.js';

const document: DocumentRow = {
  id: 'doc-1',
  userId: 'user-1',
  title: 'Capitals',
  sourceType: 'pasted',
  charCount: 64,
  chunkCount: 2,
  embeddingModel: 'mock-embedding',
  createdAt: new Date('2026-10-04T10:00:00Z'),
};

const retrieved: RetrievedChunk[] = [
  { chunkIndex: 3, content: 'Paris is the capital of France.', distance: 0.1 },
  { chunkIndex: 7, content: 'Berlin is the capital of Germany.', distance: 0.4 },
];

const settings: Record<string, unknown> = {
  PROMPT_VERSION: 'qa-v1',
  RETRIEVAL_TOP_K: 5,
  MAX_OUTPUT_TOKENS: 800,
  MAX_QUESTION_CHARS: 1000,
};

function setup(options: { chatText?: string; embeddingModel?: string } = {}) {
  const repo = {
    findNearestChunks: vi.fn().mockResolvedValue(retrieved),
    create: vi.fn(
      async (row: NewQuestion) => ({ ...row, id: 'q-1', createdAt: new Date('2026-10-04T12:00:00Z') }) as QuestionRow,
    ),
    listByDocument: vi.fn().mockResolvedValue([]),
    findChunkContents: vi.fn().mockResolvedValue(new Map()),
  };
  const documents = {
    get: vi.fn().mockResolvedValue({ ...document, embeddingModel: options.embeddingModel ?? 'mock-embedding' }),
  };
  const generate = vi.fn(async (_request: ChatRequest) =>
    textResult(options.chatText ?? JSON.stringify({ answerable: true, answer: 'Paris.', citations: [1] }), 100, 20),
  );
  const chat: ChatModel = { provider: 'test-provider', model: 'test-chat', generate };
  const config = { get: (key: string) => settings[key] } as unknown as ConfigService<Env, true>;
  const service = new QuestionsService(
    repo as unknown as QuestionsRepository,
    documents as unknown as DocumentsService,
    chat,
    new MockEmbeddingModel(),
    config,
  );
  return { service, repo, documents, generate };
}

describe('QuestionsService.ask', () => {
  it('retrieves, prompts, parses, stores and returns a grounded answer', async () => {
    const { service, repo, generate } = setup();

    const response = await service.ask('user-1', 'doc-1', '  What is the capital of France?  ');

    expect(response).toMatchObject({
      id: 'q-1',
      question: 'What is the capital of France?',
      answer: 'Paris.',
      status: 'answered',
      citations: [{ chunkIndex: 3, content: 'Paris is the capital of France.' }],
      usage: { inputTokens: 100, outputTokens: 20 },
      model: 'test-chat',
      promptVersion: 'qa-v1',
    });

    expect(repo.findNearestChunks).toHaveBeenCalledWith('doc-1', expect.any(Array), 5);
    const request = generate.mock.calls[0][0];
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].content).toContain('Paris is the capital of France.');
    expect(request.messages[0].content).toContain('What is the capital of France?');
    expect(request).toMatchObject({ temperature: 0.2, maxOutputTokens: 800 });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        userId: 'user-1',
        status: 'answered',
        citations: [3],
        retrieved: [
          { chunkIndex: 3, distance: 0.1 },
          { chunkIndex: 7, distance: 0.4 },
        ],
        promptVersion: 'qa-v1',
        provider: 'test-provider',
        model: 'test-chat',
        inputTokens: 100,
        outputTokens: 20,
      }),
    );
  });

  it('returns not_found when the model says the document does not cover it', async () => {
    const { service } = setup({ chatText: JSON.stringify({ answerable: false, answer: 'Not covered.', citations: [] }) });
    await expect(service.ask('user-1', 'doc-1', 'Who won the cup?')).resolves.toMatchObject({
      status: 'not_found',
      citations: [],
    });
  });

  it('stores nothing when the model output is malformed', async () => {
    const { service, repo } = setup({ chatText: '{"answerable": true, "answer": "Par' });
    await expect(service.ask('user-1', 'doc-1', 'Capital?')).rejects.toThrow(LlmInvalidResponseError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a document indexed with a different embedding model', async () => {
    const { service, generate } = setup({ embeddingModel: 'gemini-embedding-001' });
    await expect(service.ask('user-1', 'doc-1', 'Capital?')).rejects.toThrow(ConflictException);
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not call the model for a document the user cannot access', async () => {
    const { service, documents, repo, generate } = setup();
    documents.get.mockRejectedValue(new NotFoundException('Document not found'));
    await expect(service.ask('user-2', 'doc-1', 'Capital?')).rejects.toThrow(NotFoundException);
    await expect(service.history('user-2', 'doc-1')).rejects.toThrow(NotFoundException);
    expect(generate).not.toHaveBeenCalled();
    expect(repo.listByDocument).not.toHaveBeenCalled();
  });

  it('removes null bytes from the question, which PostgreSQL would reject', async () => {
    const { service, repo, generate } = setup();
    await service.ask('user-1', 'doc-1', 'What is\u0000 the capital?');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ question: 'What is the capital?' }));
    expect(generate.mock.calls[0][0].messages[0].content).not.toContain('\u0000');
  });

  it('logs a failed model call with its metadata and without the question', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = setup({ chatText: 'not json' });
    await expect(service.ask('user-1', 'doc-1', 'A very secret question?')).rejects.toThrow(LlmInvalidResponseError);

    const entry = warn.mock.calls[0]?.[0];
    warn.mockRestore();
    expect(entry).toMatchObject({
      event: 'question_failed',
      userId: 'user-1',
      documentId: 'doc-1',
      provider: 'test-provider',
      model: 'test-chat',
      promptVersion: 'qa-v1',
      error: 'LlmInvalidResponseError',
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(JSON.stringify(entry)).not.toContain('secret');
  });

  it('logs an answered question with its metadata and without the question, the answer or the passages', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = setup({
      chatText: JSON.stringify({ answerable: true, answer: 'The secret answer.', citations: [1] }),
    });
    await service.ask('user-1', 'doc-1', 'A very secret question?');

    const entry = log.mock.calls[0]?.[0];
    log.mockRestore();
    expect(entry).toMatchObject({
      event: 'question_answered',
      userId: 'user-1',
      documentId: 'doc-1',
      questionId: 'q-1',
      provider: 'test-provider',
      model: 'test-chat',
      promptVersion: 'qa-v1',
      status: 'answered',
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(JSON.stringify(entry)).not.toMatch(/secret|Paris/i);
  });

  it('rejects blank and oversized questions', async () => {
    const { service, generate } = setup();
    await expect(service.ask('user-1', 'doc-1', '   ')).rejects.toThrow(BadRequestException);
    await expect(service.ask('user-1', 'doc-1', 'x'.repeat(1001))).rejects.toThrow(BadRequestException);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('QuestionsService.history', () => {
  it('resolves stored citations to chunk text', async () => {
    const { service, repo } = setup();
    const row = {
      id: 'q-1',
      documentId: 'doc-1',
      userId: 'user-1',
      question: 'Capital?',
      answer: 'Paris.',
      status: 'answered',
      citations: [3],
      retrieved: [{ chunkIndex: 3, distance: 0.1 }],
      promptVersion: 'qa-v1',
      provider: 'test-provider',
      model: 'test-chat',
      inputTokens: 100,
      outputTokens: 20,
      latencyMs: 250,
      createdAt: new Date('2026-10-04T12:00:00Z'),
    } satisfies QuestionRow;
    repo.listByDocument.mockResolvedValue([row]);
    repo.findChunkContents.mockResolvedValue(new Map([[3, 'Paris is the capital of France.']]));

    const history = await service.history('user-1', 'doc-1');

    expect(repo.findChunkContents).toHaveBeenCalledWith('doc-1', [3]);
    expect(history[0].citations).toEqual([{ chunkIndex: 3, content: 'Paris is the capital of France.' }]);
  });
});
