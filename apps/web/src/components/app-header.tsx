'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export function AppHeader() {
  const { token, email, logout } = useAuth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold">
          Document Q&amp;A
        </Link>
        {token && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{email}</span>
            <button type="button" onClick={logout} className="font-medium text-blue-700 hover:underline">
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
