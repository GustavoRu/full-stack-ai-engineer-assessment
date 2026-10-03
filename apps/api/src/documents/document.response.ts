import type { DocumentRow, SourceType } from '../database/schema.js';

export type DocumentResponse = {
  id: string;
  title: string;
  sourceType: SourceType;
  charCount: number;
  chunkCount: number;
  createdAt: string;
};

export function toDocumentResponse(row: DocumentRow): DocumentResponse {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.sourceType,
    charCount: row.charCount,
    chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(),
  };
}
