import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { chunks, documents, type DocumentRow, type NewDocument } from '../database/schema.js';

export type NewChunk = { chunkIndex: number; content: string; embedding: number[] };

@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // One transaction, so a document never exists without its chunks
  async createWithChunks(document: NewDocument, newChunks: NewChunk[]): Promise<DocumentRow> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(documents).values(document).returning();
      await tx.insert(chunks).values(newChunks.map((chunk) => ({ ...chunk, documentId: created.id })));
      return created;
    });
  }

  listByUser(userId: string): Promise<DocumentRow[]> {
    return this.db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.createdAt));
  }

  async findOwned(id: string, userId: string): Promise<DocumentRow | undefined> {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);
    return document;
  }

  async deleteOwned(id: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning({ id: documents.id });
    return deleted.length > 0;
  }
}
