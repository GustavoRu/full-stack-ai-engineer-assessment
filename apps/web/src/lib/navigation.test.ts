import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/navigation';

describe('safeNextPath', () => {
  it('accepts a path inside the app', () => {
    expect(safeNextPath('/documents/abc-123')).toBe('/documents/abc-123');
  });

  it('rejects anything that could leave the app or loop back to the sign-in pages', () => {
    for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil.example', 'documents', '', null]) {
      expect(safeNextPath(unsafe), String(unsafe)).toBeNull();
    }
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/register?next=/documents')).toBeNull();
  });
});
