import { UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { extractText as extractPdfText } from 'unpdf';
import type { SourceType } from '../database/schema.js';

export interface IncomingFile {
  originalname: string;
  buffer: Buffer;
}

export interface ExtractedText {
  text: string;
  sourceType: SourceType;
}

const PDF_HEADER = Buffer.from('%PDF-');

// The type is decided by extension because browsers report Markdown MIME types inconsistently
export async function extractText(file: IncomingFile): Promise<ExtractedText> {
  const extension = file.originalname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];

  switch (extension) {
    case 'pdf':
      return { text: await readPdf(file.buffer), sourceType: 'pdf' };
    case 'txt':
      return { text: decodeUtf8(file.buffer), sourceType: 'text' };
    case 'md':
      return { text: decodeUtf8(file.buffer), sourceType: 'markdown' };
    default:
      throw new UnsupportedMediaTypeException('Supported files: .pdf, .txt and .md');
  }
}

async function readPdf(buffer: Buffer): Promise<string> {
  if (!buffer.subarray(0, PDF_HEADER.length).equals(PDF_HEADER)) {
    throw new UnsupportedMediaTypeException('The file is not a valid PDF');
  }
  try {
    const { text } = await extractPdfText(new Uint8Array(buffer), { mergePages: true });
    return text;
  } catch {
    throw new UnprocessableEntityException('The PDF could not be read');
  }
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new UnsupportedMediaTypeException('Text files must be UTF-8 encoded');
  }
}

// Multipart file names can arrive decoded as latin1; recover the UTF-8 original
export function decodeFilename(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}
