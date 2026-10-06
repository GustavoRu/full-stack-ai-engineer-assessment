'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ALERT, BUTTON, CARD, INPUT } from '@/components/styles';
import { messageOf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/navigation';

const COPY = {
  login: {
    title: 'Sign in',
    submit: 'Sign in',
    pending: 'Signing in…',
    switchText: 'New here?',
    switchLink: 'Create an account',
    switchHref: '/register',
  },
  register: {
    title: 'Create your account',
    submit: 'Create account',
    pending: 'Creating account…',
    switchText: 'Already have an account?',
    switchLink: 'Sign in instead',
    switchHref: '/login',
  },
} as const;

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { login, register, token, hydrated } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];
  const expired = search.get('expired') === '1';
  const destination = safeNextPath(search.get('next')) ?? '/documents';

  // Covers both an existing session and a submit that just succeeded
  useEffect(() => {
    if (hydrated && token) router.replace(destination);
  }, [hydrated, token, router, destination]);

  async function submit() {
    setError(null);
    setPending(true);
    try {
      await (mode === 'login' ? login(email, password) : register(email, password));
    } catch (cause) {
      setError(messageOf(cause));
      setPending(false);
    }
  }

  return (
    <section className={`${CARD} mx-auto max-w-sm`}>
      <h1 className="text-xl font-semibold">{copy.title}</h1>
      {expired && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Your session expired. Sign in again.
        </p>
      )}
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block text-sm font-medium">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={INPUT}
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={INPUT}
          />
        </label>
        {mode === 'register' && <p className="text-xs text-slate-500">At least 8 characters.</p>}
        {error && (
          <p role="alert" className={ALERT}>
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className={`${BUTTON} w-full`}>
          {pending ? copy.pending : copy.submit}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        {copy.switchText}{' '}
        <Link href={copy.switchHref} className="font-medium text-blue-700 hover:underline">
          {copy.switchLink}
        </Link>
      </p>
    </section>
  );
}
