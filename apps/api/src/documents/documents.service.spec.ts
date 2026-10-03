import {
  BadRequestException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { DocumentRow, NewDocument } from '../database/schema.js';
import { LlmRateLimitError } from '../llm/llm.errors.js';
import { MockEmbeddingModel } from '../llm/mock.adapter.js';
import { normalizeText } from './chunker.js';
import type { DocumentsRepository, NewChunk } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';

function setup(maxDocumentChars = 50_000) {
  const stored: { document: NewDocument; chunks: NewChunk[] }[] = [];
  const repo = {
    createWithChunks: vi.fn(async (document: NewDocument, chunks: NewChunk[]) => {
      stored.push({ document, chunks });
      return { ...document, id: 'doc-1', createdAt: new Date() } as DocumentRow;
    }),
    listByUser: vi.fn().mockResolvedValue([]),
    findOwned: vi.fn().mockResolvedValue(undefined),
    deleteOwned: vi.fn().mockResolvedValue(false),
  };
  const embeddings = new MockEmbeddingModel();
  const embedSpy = vi.spyOn(embeddings, 'embedDocuments');
  const config = { get: () => maxDocumentChars } as unknown as ConfigService<Env, true>;
  const service = new DocumentsService(repo as unknown as DocumentsRepository, embeddings, config);
  return { service, repo, stored, embedSpy };
}

const textFile = (originalname: string, content: string) => ({ originalname, buffer: Buffer.from(content, 'utf8') });
const longText = 'Paris is the capital of France. '.repeat(100);

describe('DocumentsService.create', () => {
  it('stores pasted text as ordered chunks with embeddings', async () => {
    const { service, stored } = setup();
    await service.create('user-1', { text: longText });

    const { document, chunks } = stored[0];
    expect(document).toMatchObject({
      userId: 'user-1',
      sourceType: 'pasted',
      embeddingModel: 'mock-embedding',
      charCount: normalizeText(longText).length,
      chunkCount: chunks.length,
    });
    expect(document.title).toHaveLength(60);
    expect(longText.startsWith(document.title)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((chunk) => chunk.embedding.length === 768)).toBe(true);
  });

  it('uses the file name as title and the file type as source', async () => {
    const { service, stored } = setup();
    await service.create('user-1', { file: textFile('notes.md', '# Notes\n\nSome content.') });
    expect(stored[0].document).toMatchObject({ title: 'notes.md', sourceType: 'markdown' });
  });

  it('prefers an explicit title', async () => {
    const { service, stored } = setup();
    await service.create('user-1', { text: 'Some content.', title: '  My document  ' });
    expect(stored[0].document.title).toBe('My document');
  });

  it('removes null bytes from the title, which PostgreSQL would reject', async () => {
    const { service, stored } = setup();
    await service.create('user-1', { text: 'Some content.', title: 'My\u0000 document' });
    expect(stored[0].document.title).toBe('My document');
  });

  it('logs the ingestion with its counts and without the document text or title', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = setup();
    await service.create('user-1', { text: 'Top secret content.', title: 'Secret plan' });

    const line = String(log.mock.calls[0]?.[0]);
    log.mockRestore();
    expect(JSON.parse(line)).toMatchObject({
      event: 'document_ingested',
      userId: 'user-1',
      documentId: 'doc-1',
      sourceType: 'pasted',
      charCount: 19,
      chunkCount: 1,
      embeddingModel: 'mock-embedding',
    });
    expect(line).not.toMatch(/secret/i);
  });

  it('logs a failed ingestion without the document text', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, embedSpy } = setup();
    embedSpy.mockRejectedValueOnce(new LlmRateLimitError('quota'));
    await expect(service.create('user-1', { text: 'Top secret content.' })).rejects.toThrow('quota');

    const line = String(warn.mock.calls[0]?.[0]);
    warn.mockRestore();
    expect(JSON.parse(line)).toMatchObject({
      event: 'document_ingest_failed',
      userId: 'user-1',
      chunkCount: 1,
      embeddingModel: 'mock-embedding',
      error: 'LlmRateLimitError',
    });
    expect(line).not.toMatch(/secret/i);
  });

  it('rejects a request with both or neither of file and text', async () => {
    const { service } = setup();
    await expect(service.create('user-1', {})).rejects.toThrow(BadRequestException);
    await expect(service.create('user-1', { text: '   ' })).rejects.toThrow(BadRequestException);
    await expect(service.create('user-1', { text: 'a', file: textFile('a.txt', 'a') })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('says what is missing when neither a file nor text is sent, and what is wrong when both are', async () => {
    const { service } = setup();
    await expect(service.create('user-1', {})).rejects.toThrow('Provide a file or some text');
    await expect(service.create('user-1', { text: 'a', file: textFile('a.txt', 'a') })).rejects.toThrow(
      'Provide either a file or text, not both',
    );
  });

  it('rejects a file with nothing to index', async () => {
    const { service } = setup();
    await expect(service.create('user-1', { file: textFile('blank.txt', ' \n ') })).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects text over the limit before calling the embedder', async () => {
    const { service, stored, embedSpy } = setup(100);
    await expect(service.create('user-1', { text: 'word '.repeat(30) })).rejects.toThrow(PayloadTooLargeException);
    expect(embedSpy).not.toHaveBeenCalled();
    expect(stored).toHaveLength(0);
  });

  it('stores nothing when embedding fails', async () => {
    const { service, repo, embedSpy } = setup();
    embedSpy.mockRejectedValueOnce(new Error('quota'));
    await expect(service.create('user-1', { text: 'Some content.' })).rejects.toThrow('quota');
    expect(repo.createWithChunks).not.toHaveBeenCalled();
  });
});

describe('DocumentsService ownership', () => {
  it('answers 404 for a document that is missing or owned by someone else', async () => {
    const { service, repo } = setup();
    await expect(service.get('doc-1', 'user-2')).rejects.toThrow(NotFoundException);
    await expect(service.remove('doc-1', 'user-2')).rejects.toThrow(NotFoundException);
    expect(repo.findOwned).toHaveBeenCalledWith('doc-1', 'user-2');
    expect(repo.deleteOwned).toHaveBeenCalledWith('doc-1', 'user-2');
  });
});
