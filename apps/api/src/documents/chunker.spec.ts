import { chunkText, normalizeText } from './chunker.js';

const sentence = 'The quick brown fox jumps over the lazy dog near the quiet river bank.';
const paragraph = Array.from({ length: 6 }, () => sentence).join(' ');
const longText = Array.from({ length: 12 }, () => paragraph).join('\n\n');

describe('normalizeText', () => {
  it('removes null bytes, which PostgreSQL text columns reject', () => {
    expect(normalizeText('Hel\u0000lo')).toBe('Hello');
  });

  it('unifies line endings and collapses extra whitespace', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(normalizeText('  one   two\t three  ')).toBe('one two three');
    expect(normalizeText('first\n\n\n\n\nsecond')).toBe('first\n\nsecond');
  });
});

describe('chunkText', () => {
  it('returns no chunks for empty or blank text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(' \n\t ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    expect(chunkText('A short note.')).toEqual([{ index: 0, content: 'A short note.' }]);
  });

  it('keeps every chunk within the size limit and numbers them in order', () => {
    const chunks = chunkText(longText);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 1000)).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
  });

  it('starts each chunk with text repeated from the end of the previous one', () => {
    const chunks = chunkText(longText);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1].content).toContain(chunks[i].content.slice(0, 20));
    }
  });

  it('loses no words', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `w${i}`);
    const joined = chunkText(words.join(' '))
      .map((chunk) => chunk.content)
      .join(' ');
    const seen = new Set(joined.split(/\s+/));
    expect(words.every((word) => seen.has(word))).toBe(true);
  });

  it('prefers to cut at paragraph and sentence boundaries', () => {
    const chunks = chunkText(longText);
    expect(chunks.every((chunk) => chunk.content.endsWith('.'))).toBe(true);
  });

  it('hard-cuts text that has no boundaries at all', () => {
    const chunks = chunkText('x'.repeat(2500));
    expect(chunks.every((chunk) => chunk.content.length <= 1000)).toBe(true);
    expect(chunks.map((chunk) => chunk.content).join('').length).toBeGreaterThanOrEqual(2500);
  });
});
