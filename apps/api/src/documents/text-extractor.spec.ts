import { UnsupportedMediaTypeException } from '@nestjs/common';
import { decodeFilename, extractText } from './text-extractor.js';

// Builds a minimal one-page PDF with a correct cross-reference table
function buildPdf(pageText: string): Buffer {
  const stream = pageText ? `BT /F1 18 Tf 20 100 Td (${pageText}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const file = (originalname: string, content: string | Buffer) => ({
  originalname,
  buffer: typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
});

describe('extractText', () => {
  it('reads plain text and Markdown as UTF-8', async () => {
    await expect(extractText(file('notes.txt', 'café ñandú'))).resolves.toEqual({
      text: 'café ñandú',
      sourceType: 'text',
    });
    await expect(extractText(file('README.MD', '# Title'))).resolves.toEqual({
      text: '# Title',
      sourceType: 'markdown',
    });
  });

  it('extracts the text layer of a PDF', async () => {
    const result = await extractText(file('paper.pdf', buildPdf('Hello PDF')));
    expect(result.sourceType).toBe('pdf');
    expect(result.text).toContain('Hello PDF');
  });

  it('returns blank text for a PDF with no text layer', async () => {
    const result = await extractText(file('scan.pdf', buildPdf('')));
    expect(result.text.trim()).toBe('');
  });

  it('rejects unsupported extensions', async () => {
    await expect(extractText(file('report.docx', 'data'))).rejects.toThrow(UnsupportedMediaTypeException);
    await expect(extractText(file('no-extension', 'data'))).rejects.toThrow(UnsupportedMediaTypeException);
  });

  it('rejects a file named .pdf that is not a PDF', async () => {
    await expect(extractText(file('fake.pdf', 'just text'))).rejects.toThrow(UnsupportedMediaTypeException);
  });

  it('rejects text files that are not valid UTF-8', async () => {
    await expect(extractText(file('binary.txt', Buffer.from([0xff, 0xfe, 0xfd])))).rejects.toThrow(
      UnsupportedMediaTypeException,
    );
  });
});

describe('decodeFilename', () => {
  it('recovers a UTF-8 name that arrived decoded as latin1', () => {
    const mangled = Buffer.from('año.txt', 'utf8').toString('latin1');
    expect(decodeFilename(mangled)).toBe('año.txt');
  });

  it('leaves correct names untouched', () => {
    expect(decodeFilename('año.txt')).toBe('año.txt');
    expect(decodeFilename('report.pdf')).toBe('report.pdf');
    expect(decodeFilename('文書.pdf')).toBe('文書.pdf');
  });
});
