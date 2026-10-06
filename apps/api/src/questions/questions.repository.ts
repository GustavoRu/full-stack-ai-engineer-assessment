import { Inject, Injectable } from '@nestjs/common';
import { and, asc, cosineDistance, eq, inArray, sql } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { chunks, type NewQuestion, type QuestionRow, questions } from '../database/schema.js';
import type { RetrievedChunk } from './answer-parser.js';

@Injectable()
export class QuestionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // Exact search: it only scans the chunks of one document, so no vector index is needed
  findNearestChunks(documentId: string, queryEmbedding: number[], limit: number): Promise<RetrievedChunk[]> {
    const distance = sql<number>`${cosineDistance(chunks.embedding, queryEmbedding)}`;
    return this.db
      .select({ chunkIndex: chunks.chunkIndex, content: chunks.content, distance })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .orderBy(distance)
      .limit(limit);
  }

  async create(row: NewQuestion): Promise<QuestionRow> {
    const [created] = await this.db.insert(questions).values(row).returning();
    return created;
  }

  listByDocument(documentId: string): Promise<QuestionRow[]> {
    return this.db
      .select()
      .from(questions)
      .where(eq(questions.documentId, documentId))
      .orderBy(asc(questions.createdAt));
  }

  async findChunkContents(documentId: string, chunkIndexes: number[]): Promise<Map<number, string>> {
    if (chunkIndexes.length === 0) return new Map();
    const rows = await this.db
      .select({ chunkIndex: chunks.chunkIndex, content: chunks.content })
      .from(chunks)
      .where(and(eq(chunks.documentId, documentId), inArray(chunks.chunkIndex, chunkIndexes)));
    return new Map(rows.map((row) => [row.chunkIndex, row.content]));
  }
}
