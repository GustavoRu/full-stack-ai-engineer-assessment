// Only addresses inside the app are allowed, so a crafted link cannot send a user elsewhere after sign-in
export function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/login') || next.startsWith('/register')) return null;
  return next;
}
