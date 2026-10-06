import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';

// Changing this requires a migration and re-embedding every document
export const EMBEDDING_DIMENSIONS = 768;

export type SourceType = 'pdf' | 'text' | 'markdown' | 'pasted';
export type AnswerStatus = 'answered' | 'unverified' | 'not_found';
export type RetrievedRef = { chunkIndex: number; distance: number };
export type AnswerMode = 'classic' | 'agentic';
export type SearchRecord = { query: string; chunkIndexes: number[] };

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const documents = pgTable(
  'documents',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sourceType: text('source_type').$type<SourceType>().notNull(),
    charCount: integer('char_count').notNull(),
    chunkCount: integer('chunk_count').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('documents_user_id_idx').on(table.userId)],
);

export const chunks = pgTable(
  'chunks',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  // Also serves lookups by document_id, its leading column
  (table) => [uniqueIndex('chunks_document_chunk_idx').on(table.documentId, table.chunkIndex)],
);

export const questions = pgTable(
  'questions',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    status: text('status').$type<AnswerStatus>().notNull(),
    citations: jsonb('citations').$type<number[]>().notNull(),
    retrieved: jsonb('retrieved').$type<RetrievedRef[]>().notNull(),
    promptVersion: text('prompt_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    // Old rows read as classic answers with one model call
    mode: text('mode').$type<AnswerMode>().notNull().default('classic'),
    searches: jsonb('searches').$type<SearchRecord[]>().notNull().default([]),
    modelCalls: integer('model_calls').notNull().default(1),
    createdAt: createdAt(),
  },
  (table) => [index('questions_document_id_idx').on(table.documentId)],
);

export type UserRow = typeof users.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
