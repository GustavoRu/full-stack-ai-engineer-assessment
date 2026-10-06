// Stops document or question text from closing its own delimiter
export const escapeDelimiters = (text: string) => text.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
