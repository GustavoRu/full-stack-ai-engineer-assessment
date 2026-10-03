export interface TextChunk {
  index: number;
  content: string;
}

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;

// Tried in order: paragraph, line, sentence, word
const SEPARATORS = ['\n\n', '\n', '. ', ' '];

export function normalizeText(text: string): string {
  return text
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): TextChunk[] {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return [];

  // Pieces leave room for the overlap prefix, so no chunk exceeds `size`
  const pieces = splitRecursive(normalized, size - overlap, SEPARATORS);

  const contents: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current.length > 0 && current.length + piece.length > size) {
      contents.push(current);
      current = overlapTail(current, overlap) + piece;
    } else {
      current += piece;
    }
  }
  contents.push(current);

  return contents
    .map((content) => content.trim())
    .filter((content) => content.length > 0)
    .map((content, index) => ({ index, content }));
}

// Splits text into pieces no longer than maxLength, preferring natural boundaries
function splitRecursive(text: string, maxLength: number, separators: string[]): string[] {
  if (text.length <= maxLength) return [text];

  const [separator, ...finerSeparators] = separators;
  if (separator === undefined) {
    const pieces: string[] = [];
    for (let start = 0; start < text.length; start += maxLength) {
      pieces.push(text.slice(start, start + maxLength));
    }
    return pieces;
  }

  return splitKeepingSeparator(text, separator).flatMap((part) => splitRecursive(part, maxLength, finerSeparators));
}

// Keeps the separator at the end of each part so joining the parts restores the text
function splitKeepingSeparator(text: string, separator: string): string[] {
  const parts = text.split(separator);
  return parts.map((part, i) => (i < parts.length - 1 ? part + separator : part)).filter((part) => part.length > 0);
}

// The last `overlap` characters of a chunk, starting at a word boundary when there is one
function overlapTail(chunk: string, overlap: number): string {
  if (overlap <= 0) return '';
  const tail = chunk.slice(-overlap);
  const firstSpace = tail.search(/\s/);
  return firstSpace === -1 ? tail : tail.slice(firstSpace + 1);
}
