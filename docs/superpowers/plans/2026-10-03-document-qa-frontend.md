# Document Q&A Assistant: Frontend Implementation Plan (2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js app where a user signs in, uploads a document, asks questions about it, and sees each answer with its status and sources.

**Architecture:** A client-rendered Next.js App Router app that talks to the existing NestJS API over HTTP. One fetch wrapper owns the token, the headers and the error messages; one auth context exposes the session; pages compose small components. The token lives in `localStorage` and React reads it through `useSyncExternalStore`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, pnpm 10, Vitest with React Testing Library, Docker on `node:24-slim`.

**Spec:** [docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md](../specs/2026-10-03-document-qa-assistant-design.md), section 8.

**Plan series:**

1. Backend API, database and Docker for both: done.
2. Frontend and the full Compose stack (this plan).
3. Terraform, final README and delivery checks.

## Global Constraints

- Package manager is pnpm 10. The app lives in `apps/web` with its own `package.json`.
- The API base URL comes from `NEXT_PUBLIC_API_URL`, which defaults to `http://localhost:3001/api`. It is inlined at build time.
- Pages are client components. No component library and no data-fetching library.
- Model output is rendered as plain text, never as HTML or Markdown.
- The token is stored in `localStorage` under `docqa.token` and sent as `Authorization: Bearer`.
- React state is never set synchronously inside an effect body: the Next.js 16 lint config rejects it. External state is read with `useSyncExternalStore`; effects only set state from promise callbacks.
- Tests run with Vitest and jsdom, with explicit imports from `vitest` (no globals). Test files are `*.test.ts` or `*.test.tsx` next to the code.
- User-facing copy is in English. Every label, button name and message used by a test or by the smoke test must match the code exactly.
- Code comments are in English, one line, with no task identifiers.
- Commits follow Conventional Commits and carry no co-author or AI attribution trailer.
- Work happens on the branch `feat/document-qa-assistant` in this checkout. No worktrees.
- Running the API for manual checks uses `LLM_PROVIDER=mock`, so no provider quota is spent.

## Review Focus

Inputs the spec implies but does not spell out, most likely first. Each has a test in the task that owns the code.

1. **An expired or invalid session** (a 401 while a token is stored) clears the session and returns the user to the login page. Task 1.
2. **A rate limit response** (429) shows its own message and keeps the question so the user can retry. Task 4.
3. **Model output that contains HTML** is shown as text and never becomes markup. Task 4.
4. **A double submit** while a question is pending sends only one request. Task 4.
5. **Validation errors that arrive as a list** and network failures are shown as readable messages. Task 1.

## Checkpoints

| After task | What to review |
|---|---|
| 2 | Scaffold, API client, session handling, sign-in and sign-up in the browser |
| 5 | Documents page, Q&A page, Docker, the full stack end to end |

## File Structure

```
apps/web/
├── Dockerfile
├── .dockerignore
├── next.config.ts              standalone output for Docker
├── vitest.config.mts
├── vitest.setup.ts
└── src/
    ├── app/
    │   ├── layout.tsx          root layout: auth provider and header
    │   ├── globals.css
    │   ├── page.tsx            redirects to /documents or /login
    │   ├── login/page.tsx
    │   ├── register/page.tsx
    │   ├── documents/page.tsx
    │   └── documents/[id]/page.tsx
    ├── components/
    │   ├── styles.ts           shared Tailwind class strings
    │   ├── states.tsx          Spinner, EmptyState, ErrorState
    │   ├── app-header.tsx
    │   ├── require-auth.tsx    sends anonymous users to /login
    │   ├── auth-form.tsx       sign-in and sign-up form
    │   ├── upload-form.tsx     file or pasted text
    │   ├── document-list.tsx
    │   ├── answer-card.tsx     status, answer, sources, ask again
    │   └── question-panel.tsx  question form, pending state, answer list
    └── lib/
        ├── types.ts            API response types
        ├── api.ts              fetch wrapper, token store, ApiError
        ├── auth.tsx            AuthProvider and useAuth
        └── use-load.ts         load-on-mount hook with loading and error state
```

---

### Task 1: Scaffold and API client

**Files:**
- Create: `apps/web/` (Next.js scaffold), `apps/web/vitest.config.mts`, `apps/web/vitest.setup.ts`
- Create: `apps/web/src/lib/types.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`
- Modify: `apps/web/next.config.ts`, `apps/web/package.json`, `apps/web/src/app/globals.css`, `.gitignore`
- Delete: the scaffold's `README.md` and `public/` folder

**Interfaces:**
- Consumes: the API of Plan 1 (`/auth/*`, `/documents`, `/documents/:id/questions`).
- Produces:
  - Types `SourceType`, `AnswerStatus`, `DocumentSummary`, `Citation`, `Question`.
  - `class ApiError extends Error { status: number }`. Status `0` means the server could not be reached.
  - `tokenStore: { get(): string | null; set(token: string): void; clear(): void; subscribe(listener: () => void): () => void }`.
  - `apiFetch<T>(path: string, options?: { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown; formData?: FormData }): Promise<T>`.
  - `messageOf(error: unknown): string` and `emailFromToken(token: string): string | null`.

- [ ] **Step 1: Scaffold the app**

```bash
cd apps
npx -y create-next-app@16 web --ts --tailwind --eslint --app --src-dir --use-pnpm --import-alias "@/*" --disable-git --yes
cd web
rm -rf README.md public
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths
npm pkg set scripts.test="vitest run" scripts.typecheck="tsc --noEmit"
```

Expected: `apps/web/node_modules` exists and `package.json` has the `test` and `typecheck` scripts.

- [ ] **Step 2: Read the bundled Next.js guides before writing code**

The scaffold's `AGENTS.md` asks for this, because Next.js 16 differs from older versions. Skim these three files:

```bash
ls node_modules/next/dist/docs/01-app/
sed -n '1,80p' node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md
sed -n '1,60p' node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-params.md
sed -n '1,60p' node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
```

Expected: `useRouter` and `useParams` come from `next/navigation` and work in client components; `output: 'standalone'` writes `.next/standalone/server.js`. If any of this differs, follow the guide and note the difference in the ledger.

- [ ] **Step 3: Keep the agent files out of the repository**

`next dev` regenerates `AGENTS.md` and `CLAUDE.md` in the app folder. They are tooling notes, not product files. Append to the root `.gitignore`:

```gitignore

# Regenerated by `next dev`
apps/web/AGENTS.md
apps/web/CLAUDE.md
```

- [ ] **Step 4: Configure the build and the test runner**

Replace `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone for the Docker image
  output: 'standalone',
};

export default nextConfig;
```

Create `apps/web/vitest.config.mts`:

```ts
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

Create `apps/web/vitest.setup.ts`:

```ts
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmounts rendered components between tests
afterEach(cleanup);
```

Replace `apps/web/src/app/globals.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 5: Create `apps/web/src/lib/types.ts`**

```ts
export type SourceType = 'pdf' | 'text' | 'markdown' | 'pasted';
export type AnswerStatus = 'answered' | 'unverified' | 'not_found';

export interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  charCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface Citation {
  chunkIndex: number;
  content: string;
}

export interface Question {
  id: string;
  question: string;
  answer: string;
  status: AnswerStatus;
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  promptVersion: string;
  createdAt: string;
}
```

- [ ] **Step 6: Write the failing test**

Create `apps/web/src/lib/api.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, emailFromToken, messageOf, tokenStore } from '@/lib/api';

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  window.localStorage.clear();
});

describe('apiFetch', () => {
  it('sends JSON with the stored token and returns the parsed body', async () => {
    tokenStore.set('abc');
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'q-1' }));

    const result = await apiFetch<{ id: string }>('/documents/d-1/questions', {
      method: 'POST',
      json: { question: 'Why?' },
    });

    expect(result).toEqual({ id: 'q-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/documents/d-1/questions', {
      method: 'POST',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      body: '{"question":"Why?"}',
    });
  });

  it('sends form data without a content type, so the browser adds the boundary', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'd-1' }));
    const formData = new FormData();
    formData.append('text', 'hello');

    await apiFetch('/documents', { method: 'POST', formData });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/documents', {
      method: 'POST',
      headers: {},
      body: formData,
    });
  });

  it('returns undefined for a 204 response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/documents/d-1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('joins a list of validation messages into one readable message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { message: ['email must be an email', 'password is too short'], error: 'Bad Request' }),
    );
    await expect(apiFetch('/auth/register', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 400,
      message: 'email must be an email. password is too short',
    });
  });

  it('uses the message of the API for other errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Document not found' }));
    const failure = apiFetch('/documents/d-9');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 404, message: 'Document not found' });
  });

  it('shows one fixed message when rate limited', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { message: 'ThrottlerException: Too Many Requests' }));
    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 429,
      message: 'Limit reached. Try again in a minute.',
    });
  });

  it('reports a network failure with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 0,
      message: 'Could not reach the server. Check your connection and try again.',
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed with status 502',
    });
  });
});

describe('session handling', () => {
  it('clears an expired session on 401 and tells subscribers', async () => {
    tokenStore.set('expired');
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Invalid or expired token' }));

    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 401,
      message: 'Your session expired. Sign in again.',
    });
    expect(tokenStore.get()).toBeNull();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps the API message on 401 when there was no session, as with wrong credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Invalid credentials' }));
    await expect(apiFetch('/auth/login', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    });
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const listener = vi.fn();
    tokenStore.subscribe(listener)();
    tokenStore.set('abc');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('reads the email from a token payload', () => {
    const token = ['header', btoa(JSON.stringify({ sub: 'u-1', email: 'ada@example.com' })), 'signature'].join('.');
    expect(emailFromToken(token)).toBe('ada@example.com');
  });

  it('returns null for a token it cannot read', () => {
    expect(emailFromToken('not-a-token')).toBeNull();
    expect(emailFromToken('a.%%%.c')).toBeNull();
  });

  it('turns any thrown value into a message', () => {
    expect(messageOf(new ApiError(404, 'Document not found'))).toBe('Document not found');
    expect(messageOf('boom')).toBe('Something went wrong. Try again.');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL, cannot resolve `@/lib/api`.

- [ ] **Step 8: Implement `apps/web/src/lib/api.ts`**

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const TOKEN_KEY = 'docqa.token';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// The token lives outside React, so components read it through useSyncExternalStore
export const tokenStore = {
  get(): string | null {
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    window.localStorage.setItem(TOKEN_KEY, token);
    notify();
  },
  clear() {
    window.localStorage.removeItem(TOKEN_KEY);
    notify();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

type RequestOptions = { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown; formData?: FormData };

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.formData) {
    // No Content-Type here: the browser adds it with the multipart boundary
    body = options.formData;
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { method: options.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  if (response.status === 401 && token) {
    // Clearing the token makes every subscribed component fall back to the login page
    tokenStore.clear();
    throw new ApiError(401, 'Your session expired. Sign in again.');
  }
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(response.status, payload));
  }
  return payload as T;
}

function errorMessage(status: number, payload: unknown): string {
  if (status === 429) return 'Limit reached. Try again in a minute.';
  const message = (payload as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;
  return `Request failed with status ${status}`;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

// Only for display: the API verifies the token, the browser just reads its payload
export function emailFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const email = (JSON.parse(atob(payload)) as { email?: unknown }).email;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test`
Expected: PASS, 14 tests.

- [ ] **Step 10: Lint, typecheck, build and commit**

```bash
pnpm lint && pnpm typecheck && pnpm build
cd ../..
git add .gitignore apps/web
git status --short | grep -E "AGENTS|CLAUDE" ; echo "agent files staged: $?"
git commit -m "feat(web): scaffold Next.js app with a tested API client"
```

Expected: lint, typecheck and build succeed. The grep prints nothing and the echo shows `1`, meaning no agent file is staged.

---

### Task 2: Session, layout and sign-in

**Files:**
- Create: `apps/web/src/lib/auth.tsx`
- Create: `apps/web/src/components/styles.ts`, `states.tsx`, `app-header.tsx`, `require-auth.tsx`, `auth-form.tsx`, `auth-form.test.tsx`
- Create: `apps/web/src/app/login/page.tsx`, `apps/web/src/app/register/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `tokenStore`, `emailFromToken`, `messageOf` from Task 1.
- Produces:
  - `AuthProvider` and `useAuth(): { token: string | null; email: string | null; hydrated: boolean; login(email, password): Promise<void>; register(email, password): Promise<void>; logout(): void }`.
  - `RequireAuth({ children })`, which renders nothing and redirects to `/login` when there is no session.
  - `Spinner({ label })`, `EmptyState({ title, hint })`, `ErrorState({ message, onRetry })`.
  - Class strings `INPUT`, `BUTTON`, `BUTTON_SECONDARY`, `CARD`, `ALERT`.
  - `AuthForm({ mode: 'login' | 'register' })`.
  - Copy used by later tests: labels `Email` and `Password`; buttons `Sign in`, `Create account`, `Sign out`, `Try again`; links `Create an account`, `Sign in instead`.

- [ ] **Step 1: Create `apps/web/src/lib/auth.tsx`**

```tsx
'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { apiFetch, emailFromToken, tokenStore } from '@/lib/api';

type AuthContextValue = {
  token: string | null;
  email: string | null;
  // False while rendering on the server and hydrating, when localStorage cannot be read
  hydrated: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const subscribeToNothing = () => () => {};

export function AuthProvider({ children }: { children: ReactNode }) {
  // The server snapshot is null, so server and first client render match
  const token = useSyncExternalStore(tokenStore.subscribe, tokenStore.get, () => null);
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const authenticate = useCallback(async (path: string, email: string, password: string) => {
    const { accessToken } = await apiFetch<{ accessToken: string }>(path, {
      method: 'POST',
      json: { email, password },
    });
    tokenStore.set(accessToken);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      email: token ? emailFromToken(token) : null,
      hydrated,
      login: (email, password) => authenticate('/auth/login', email, password),
      register: (email, password) => authenticate('/auth/register', email, password),
      logout: () => tokenStore.clear(),
    }),
    [token, hydrated, authenticate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
```

- [ ] **Step 2: Create the shared styles and state components**

`apps/web/src/components/styles.ts`:

```ts
export const INPUT =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal shadow-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600';

export const BUTTON =
  'inline-flex items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50';

export const BUTTON_SECONDARY =
  'inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export const CARD = 'rounded-lg border border-slate-200 bg-white p-5 shadow-sm';

export const ALERT = 'rounded-md bg-red-50 p-3 text-sm text-red-700';
```

`apps/web/src/components/states.tsx`:

```tsx
import { ALERT, BUTTON_SECONDARY } from '@/components/styles';

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      {label}…
    </p>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{hint}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={`${ALERT} flex items-center justify-between gap-4`}>
      <span>{message}</span>
      <button type="button" onClick={onRetry} className={BUTTON_SECONDARY}>
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create the header and the route guard**

`apps/web/src/components/app-header.tsx`:

```tsx
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
```

`apps/web/src/components/require-auth.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useAuth } from '@/lib/auth';

// Renders its children only for a signed-in user; anyone else goes to the login page
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, hydrated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !token) router.replace('/login');
  }, [hydrated, token, router]);

  if (!hydrated || !token) return null;
  return <>{children}</>;
}
```

- [ ] **Step 4: Write the failing form test**

Create `apps/web/src/components/auth-form.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from '@/components/auth-form';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    router: { replace },
    auth: {
      token: null as string | null,
      email: null as string | null,
      hydrated: true,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    },
  };
});

vi.mock('@/lib/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));

function fillCredentials() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
}

beforeEach(() => {
  mocks.auth.token = null;
  mocks.auth.login.mockReset().mockResolvedValue(undefined);
  mocks.auth.register.mockReset().mockResolvedValue(undefined);
  mocks.replace.mockReset();
});

describe('AuthForm', () => {
  it('signs in with the typed credentials', async () => {
    render(<AuthForm mode="login" />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mocks.auth.login).toHaveBeenCalledWith('ada@example.com', 'correct-horse'));
    expect(mocks.auth.register).not.toHaveBeenCalled();
  });

  it('creates an account in register mode', async () => {
    render(<AuthForm mode="register" />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.auth.register).toHaveBeenCalledWith('ada@example.com', 'correct-horse'));
  });

  it('shows the error and lets the user try again', async () => {
    mocks.auth.login.mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    render(<AuthForm mode="login" />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid credentials');
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends a signed-in user to the documents page', () => {
    mocks.auth.token = 'a-token';
    render(<AuthForm mode="login" />);
    expect(mocks.replace).toHaveBeenCalledWith('/documents');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm test src/components/auth-form.test.tsx`
Expected: FAIL, cannot resolve `@/components/auth-form`.

- [ ] **Step 6: Implement `apps/web/src/components/auth-form.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ALERT, BUTTON, CARD, INPUT } from '@/components/styles';
import { messageOf } from '@/lib/api';
import { useAuth } from '@/lib/auth';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];

  // Covers both an existing session and a submit that just succeeded
  useEffect(() => {
    if (hydrated && token) router.replace('/documents');
  }, [hydrated, token, router]);

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
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test src/components/auth-form.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 8: Create the layout and the pages**

Replace `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'Document Q&A Assistant',
  description: 'Ask questions about your documents and get answers with their sources.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <AuthProvider>
          <AppHeader />
          <main className="mx-auto w-full max-w-3xl px-4 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
```

Replace `apps/web/src/app/page.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { token, hydrated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (hydrated) router.replace(token ? '/documents' : '/login');
  }, [hydrated, token, router]);

  return null;
}
```

Create `apps/web/src/app/login/page.tsx`:

```tsx
import { AuthForm } from '@/components/auth-form';

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
```

Create `apps/web/src/app/register/page.tsx`:

```tsx
import { AuthForm } from '@/components/auth-form';

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
```

- [ ] **Step 9: Verify the pages are served**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
PORT=3000 node .next/standalone/server.js & WEB_PID=$!
curl -s --retry 10 --retry-all-errors --retry-delay 1 -o /dev/null -w 'login %{http_code}\n' localhost:3000/login
curl -s localhost:3000/login | grep -o 'Sign in' | head -1
curl -s localhost:3000/register | grep -o 'Create your account' | head -1
curl -s -o /dev/null -w 'home %{http_code}\n' localhost:3000/
kill $WEB_PID
```

Expected: `login 200`, the text `Sign in`, the text `Create your account`, and `home 200`. All checks before it succeed, with 18 tests passing.

- [ ] **Step 10: Commit**

```bash
cd ../..
git add apps/web
git commit -m "feat(web): add session handling, layout and sign-in pages"
```

**Checkpoint:** stop here. Start the API with `docker compose up -d db api` and the app with `pnpm dev` in `apps/web`, then try sign-up, sign-out and sign-in in the browser at http://localhost:3000.

---

### Task 3: Documents page

**Files:**
- Create: `apps/web/src/lib/use-load.ts`
- Create: `apps/web/src/components/upload-form.tsx`, `upload-form.test.tsx`, `document-list.tsx`
- Create: `apps/web/src/app/documents/page.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `messageOf`, `ApiError` (Task 1); `RequireAuth`, the state components and the class strings (Task 2); `DocumentSummary` (Task 1).
- Produces:
  - `useLoad<T>(load: () => Promise<T>): { data: T | null; error: string | null; loading: boolean; reload(): void; setData(update: (current: T) => T): void }`. The `load` function must be stable (wrap it in `useCallback`).
  - `UploadForm({ onCreated: (document: DocumentSummary) => void })`.
  - `DocumentList({ documents, onDelete: (id: string) => void })`.
  - Copy used by the smoke test: buttons `Upload a file`, `Paste text`, `Upload document`; label `Text`; empty state `Upload your first document`.

- [ ] **Step 1: Create `apps/web/src/lib/use-load.ts`**

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { messageOf } from '@/lib/api';

type LoadState<T> = { data: T | null; error: string | null; loading: boolean };

// Runs an async loader on mount and whenever it changes; `reload` runs it again
export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ data: null, error: messageOf(cause), loading: false });
      });
    // Ignores a response that arrives after the component unmounted or reloaded
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, error: null, loading: true }));
    setAttempt((value) => value + 1);
  }, []);

  const setData = useCallback((update: (current: T) => T) => {
    setState((current) => (current.data === null ? current : { ...current, data: update(current.data) }));
  }, []);

  return { ...state, reload, setData };
}
```

- [ ] **Step 2: Write the failing upload test**

Create `apps/web/src/components/upload-form.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadForm } from '@/components/upload-form';
import { ApiError, apiFetch } from '@/lib/api';
import type { DocumentSummary } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const created: DocumentSummary = {
  id: 'd-1',
  title: 'Notes',
  sourceType: 'pasted',
  charCount: 11,
  chunkCount: 1,
  createdAt: '2026-10-04T12:00:00.000Z',
};

const submitButton = () => screen.getByRole('button', { name: /Upload document|Processing document/ }) as HTMLButtonElement;

function pasteText(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Paste text' }));
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: text } });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('UploadForm', () => {
  it('keeps the button disabled until there is something to upload', () => {
    render(<UploadForm onCreated={vi.fn()} />);
    expect(submitButton().disabled).toBe(true);

    pasteText('   ');
    expect(submitButton().disabled).toBe(true);

    pasteText('hello world');
    expect(submitButton().disabled).toBe(false);
  });

  it('shows a processing state while uploading, then reports the new document', async () => {
    let finish: (document: DocumentSummary) => void = () => {};
    apiFetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onCreated = vi.fn();
    render(<UploadForm onCreated={onCreated} />);

    pasteText('hello world');
    fireEvent.click(submitButton());

    expect(submitButton().textContent).toBe('Processing document…');
    expect(submitButton().disabled).toBe(true);
    const [path, options] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/documents');
    expect((options?.formData as FormData).get('text')).toBe('hello world');

    finish(created);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect((screen.getByLabelText('Text') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows the error and lets the user try again', async () => {
    apiFetchMock.mockRejectedValue(new ApiError(413, 'The document has 60000 characters and the limit is 50000'));
    const onCreated = vi.fn();
    render(<UploadForm onCreated={onCreated} />);

    pasteText('hello world');
    fireEvent.click(submitButton());

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The document has 60000 characters and the limit is 50000',
    );
    expect(submitButton().disabled).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/components/upload-form.test.tsx`
Expected: FAIL, cannot resolve `@/components/upload-form`.

- [ ] **Step 4: Implement `apps/web/src/components/upload-form.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { ALERT, BUTTON, BUTTON_SECONDARY, CARD, INPUT } from '@/components/styles';
import { apiFetch, messageOf } from '@/lib/api';
import type { DocumentSummary } from '@/lib/types';

type Mode = 'file' | 'text';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'file', label: 'Upload a file' },
  { mode: 'text', label: 'Paste text' },
];

export function UploadForm({ onCreated }: { onCreated: (document: DocumentSummary) => void }) {
  const [mode, setMode] = useState<Mode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasContent = mode === 'file' ? file !== null : text.trim().length > 0;

  async function submit() {
    setError(null);
    setPending(true);
    const formData = new FormData();
    if (mode === 'file' && file) formData.append('file', file);
    if (mode === 'text') formData.append('text', text);
    if (title.trim()) formData.append('title', title.trim());

    try {
      const created = await apiFetch<DocumentSummary>('/documents', { method: 'POST', formData });
      setFile(null);
      setText('');
      setTitle('');
      if (fileInput.current) fileInput.current.value = '';
      onCreated(created);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className={`${CARD} space-y-4`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-2">
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => setMode(option.mode)}
            className={`${BUTTON_SECONDARY} aria-pressed:border-blue-700 aria-pressed:text-blue-700`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'file' ? (
        <label className="block text-sm font-medium">
          File
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.md"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className={INPUT}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            PDF with selectable text, .txt or .md. Up to 5 MB and about 15 pages.
          </span>
        </label>
      ) : (
        <label className="block text-sm font-medium">
          Text
          <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} className={INPUT} />
        </label>
      )}

      <label className="block text-sm font-medium">
        Title (optional)
        <input
          type="text"
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={INPUT}
        />
      </label>

      {error && (
        <p role="alert" className={ALERT}>
          {error}
        </p>
      )}

      <button type="submit" disabled={pending || !hasContent} className={BUTTON}>
        {pending ? 'Processing document…' : 'Upload document'}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/upload-form.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Create `apps/web/src/components/document-list.tsx`**

```tsx
import Link from 'next/link';
import type { DocumentSummary, SourceType } from '@/lib/types';

const SOURCE_LABEL: Record<SourceType, string> = {
  pdf: 'PDF',
  text: 'Text file',
  markdown: 'Markdown',
  pasted: 'Pasted text',
};

type Props = { documents: DocumentSummary[]; onDelete: (id: string) => void };

export function DocumentList({ documents, onDelete }: Props) {
  return (
    <ul className="space-y-2">
      {documents.map((document) => (
        <li
          key={document.id}
          className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="min-w-0">
            <Link
              href={`/documents/${document.id}`}
              className="block truncate font-medium text-blue-700 hover:underline"
            >
              {document.title}
            </Link>
            <p className="text-xs text-slate-500">
              {SOURCE_LABEL[document.sourceType]} · {document.chunkCount}{' '}
              {document.chunkCount === 1 ? 'passage' : 'passages'} ·{' '}
              {new Date(document.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Delete ${document.title}`}
            onClick={() => onDelete(document.id)}
            className="text-sm text-red-700 hover:underline"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: Create `apps/web/src/app/documents/page.tsx`**

```tsx
'use client';

import { useCallback, useState } from 'react';
import { DocumentList } from '@/components/document-list';
import { RequireAuth } from '@/components/require-auth';
import { EmptyState, ErrorState, Spinner } from '@/components/states';
import { ALERT } from '@/components/styles';
import { UploadForm } from '@/components/upload-form';
import { apiFetch, messageOf } from '@/lib/api';
import type { DocumentSummary } from '@/lib/types';
import { useLoad } from '@/lib/use-load';

export default function DocumentsPage() {
  return (
    <RequireAuth>
      <Documents />
    </RequireAuth>
  );
}

function Documents() {
  const load = useCallback(() => apiFetch<DocumentSummary[]>('/documents'), []);
  const { data: documents, error, loading, reload, setData } = useLoad(load);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove(id: string) {
    if (!window.confirm('Delete this document and all its questions?')) return;
    setDeleteError(null);
    try {
      await apiFetch<void>(`/documents/${id}`, { method: 'DELETE' });
      setData((current) => current.filter((document) => document.id !== id));
    } catch (cause) {
      setDeleteError(messageOf(cause));
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Your documents</h1>
        <p className="mt-1 text-sm text-slate-600">Upload a document, then open it to ask questions about it.</p>
      </section>

      <UploadForm onCreated={(created) => setData((current) => [created, ...current])} />

      <section className="space-y-3">
        {loading && <Spinner label="Loading documents" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {deleteError && (
          <p role="alert" className={ALERT}>
            {deleteError}
          </p>
        )}
        {documents && documents.length === 0 && (
          <EmptyState
            title="Upload your first document"
            hint="It will show up here as soon as it has been processed."
          />
        )}
        {documents && documents.length > 0 && (
          <DocumentList documents={documents} onDelete={(id) => void remove(id)} />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 8: Run all checks and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd ../..
git add apps/web
git commit -m "feat(web): add documents page with upload and delete"
```

Expected: all four succeed, with 21 tests passing and `/documents` listed in the build output.

---

### Task 4: Question and answer page

**Files:**
- Create: `apps/web/src/components/answer-card.tsx`, `answer-card.test.tsx`
- Create: `apps/web/src/components/question-panel.tsx`, `question-panel.test.tsx`
- Create: `apps/web/src/app/documents/[id]/page.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `messageOf`, `ApiError`, `Question`, `DocumentSummary` (Task 1); `RequireAuth`, state components, class strings (Task 2); `useLoad` (Task 3).
- Produces:
  - `AnswerCard({ question: Question; onReask: (text: string) => void })`.
  - `QuestionPanel({ documentId: string; initialQuestions: Question[] })`.
  - Copy used by the smoke test: label `Your question`; button `Ask`; status `Thinking`; badges `Answered from the document`, `Not verified`, `Not in the document`; buttons `Show sources (N)`, `Hide sources`, `Edit and ask again`; empty state `Ask your first question`; source heading `Passage N`.

- [ ] **Step 1: Write the failing card test**

Create `apps/web/src/components/answer-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnswerCard } from '@/components/answer-card';
import type { Question } from '@/lib/types';

const base: Question = {
  id: 'q-1',
  question: 'How much notice is needed?',
  answer: 'Thirty days of written notice.',
  status: 'answered',
  citations: [{ chunkIndex: 4, content: 'The contract can be terminated with 30 days written notice.' }],
  usage: { inputTokens: 230, outputTokens: 37 },
  model: 'gemini-3.1-flash-lite',
  promptVersion: 'qa-v1',
  createdAt: '2026-10-04T12:00:00.000Z',
};

describe('AnswerCard', () => {
  it('shows a grounded answer and reveals its sources on demand', () => {
    render(<AnswerCard question={base} onReask={vi.fn()} />);

    expect(screen.getByText('Thirty days of written notice.')).toBeTruthy();
    expect(screen.getByText('Answered from the document')).toBeTruthy();
    expect(screen.queryByText(/30 days written notice/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show sources (1)' }));
    expect(screen.getByText('Passage 5')).toBeTruthy();
    expect(screen.getByText(/30 days written notice/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide sources' }));
    expect(screen.queryByText(/30 days written notice/)).toBeNull();
  });

  it('warns when the answer could not be tied to the document', () => {
    render(<AnswerCard question={{ ...base, status: 'unverified', citations: [] }} onReask={vi.fn()} />);

    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText(/could not be tied to a passage/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sources/ })).toBeNull();
  });

  it('suggests rephrasing when the document does not cover the question', () => {
    const question: Question = { ...base, status: 'not_found', answer: 'The document does not cover this.', citations: [] };
    render(<AnswerCard question={question} onReask={vi.fn()} />);

    expect(screen.getByText('Not in the document')).toBeTruthy();
    expect(screen.getByText(/Try rephrasing/)).toBeTruthy();
  });

  it('hands the question back to be edited and asked again', () => {
    const onReask = vi.fn();
    render(<AnswerCard question={base} onReask={onReask} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit and ask again' }));
    expect(onReask).toHaveBeenCalledWith('How much notice is needed?');
  });

  it('renders model output as text, never as markup', () => {
    const answer = '<img src=x onerror="alert(1)"> **bold** <b>tag</b>';
    const { container } = render(<AnswerCard question={{ ...base, answer }} onReask={vi.fn()} />);

    expect(screen.getByText(answer)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows the model, prompt version and token count', () => {
    render(<AnswerCard question={base} onReask={vi.fn()} />);
    expect(screen.getByText('gemini-3.1-flash-lite · qa-v1 · 267 tokens')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/answer-card.test.tsx`
Expected: FAIL, cannot resolve `@/components/answer-card`.

- [ ] **Step 3: Implement `apps/web/src/components/answer-card.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { BUTTON_SECONDARY, CARD } from '@/components/styles';
import type { AnswerStatus, Question } from '@/lib/types';

const STATUS: Record<AnswerStatus, { label: string; badge: string }> = {
  answered: { label: 'Answered from the document', badge: 'bg-emerald-100 text-emerald-800' },
  unverified: { label: 'Not verified', badge: 'bg-amber-100 text-amber-800' },
  not_found: { label: 'Not in the document', badge: 'bg-slate-200 text-slate-700' },
};

const NOTE: Partial<Record<AnswerStatus, string>> = {
  unverified: 'This answer could not be tied to a passage of the document. Check it before relying on it.',
  not_found: 'The document does not seem to cover this. Try rephrasing the question or asking something more specific.',
};

type Props = { question: Question; onReask: (text: string) => void };

export function AnswerCard({ question, onReask }: Props) {
  const [showSources, setShowSources] = useState(false);
  const status = STATUS[question.status];
  const note = NOTE[question.status];
  const totalTokens = question.usage.inputTokens + question.usage.outputTokens;

  return (
    <article className={`${CARD} space-y-3`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium">{question.question}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.badge}`}>{status.label}</span>
      </header>

      {/* Plain text on purpose: model output is never rendered as HTML or Markdown */}
      <p className="whitespace-pre-wrap text-sm leading-6">{question.answer}</p>

      {note && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{note}</p>}

      {question.citations.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={showSources}
            onClick={() => setShowSources((visible) => !visible)}
            className={BUTTON_SECONDARY}
          >
            {showSources ? 'Hide sources' : `Show sources (${question.citations.length})`}
          </button>
          {showSources && (
            <ol className="space-y-2">
              {question.citations.map((citation) => (
                <li key={citation.chunkIndex} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Passage {citation.chunkIndex + 1}</p>
                  <blockquote className="mt-1 whitespace-pre-wrap text-sm">{citation.content}</blockquote>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={() => onReask(question.question)} className={BUTTON_SECONDARY}>
          Edit and ask again
        </button>
        <span className="text-xs text-slate-500">
          {question.model} · {question.promptVersion} · {totalTokens} tokens
        </span>
      </footer>
    </article>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/answer-card.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing panel test**

Create `apps/web/src/components/question-panel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionPanel } from '@/components/question-panel';
import { ApiError, apiFetch } from '@/lib/api';
import type { Question } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const answered: Question = {
  id: 'q-1',
  question: 'What is the capital of France?',
  answer: 'Paris.',
  status: 'answered',
  citations: [{ chunkIndex: 0, content: 'Paris is the capital of France.' }],
  usage: { inputTokens: 200, outputTokens: 20 },
  model: 'mock-chat',
  promptVersion: 'qa-v1',
  createdAt: '2026-10-04T12:00:00.000Z',
};

const input = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
const askButton = () => screen.getByRole('button', { name: /^(Ask|Thinking…)$/ }) as HTMLButtonElement;

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('QuestionPanel', () => {
  it('shows an empty state before any question', () => {
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);
    expect(screen.getByText('Ask your first question')).toBeTruthy();
    expect(askButton().disabled).toBe(true);
  });

  it('shows the model thinking, then the answer, and clears the form', async () => {
    let finish: (question: Question) => void = () => {};
    apiFetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);

    type('What is the capital of France?');
    fireEvent.click(askButton());

    expect(screen.getByRole('status').textContent).toContain('Thinking');
    expect(screen.queryByText('Ask your first question')).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledWith('/documents/d-1/questions', {
      method: 'POST',
      json: { question: 'What is the capital of France?' },
    });

    finish(answered);
    expect(await screen.findByText('Paris.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(input().value).toBe('');
  });

  it('sends only one request when the user submits twice', () => {
    apiFetchMock.mockReturnValue(new Promise(() => {}));
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);

    type('What is the capital of France?');
    fireEvent.click(askButton());
    fireEvent.click(askButton());
    fireEvent.submit(input().form as HTMLFormElement);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(askButton().disabled).toBe(true);
  });

  it('keeps the question and offers a retry when the request is rate limited', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(429, 'Limit reached. Try again in a minute.'));
    apiFetchMock.mockResolvedValueOnce(answered);
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);

    type('What is the capital of France?');
    fireEvent.click(askButton());

    expect((await screen.findByRole('alert')).textContent).toContain('Limit reached. Try again in a minute.');
    expect(input().value).toBe('What is the capital of France?');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Paris.')).toBeTruthy();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lists earlier answers newest first', () => {
    const older = { ...answered, id: 'q-0', question: 'Older question?', answer: 'Older answer.' };
    render(<QuestionPanel documentId="d-1" initialQuestions={[older, answered]} />);

    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['What is the capital of France?', 'Older question?']);
  });

  it('copies an earlier question into the form to edit and ask again', async () => {
    render(<QuestionPanel documentId="d-1" initialQuestions={[answered]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit and ask again' }));

    await waitFor(() => expect(input().value).toBe('What is the capital of France?'));
    expect(document.activeElement).toBe(input());
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test src/components/question-panel.test.tsx`
Expected: FAIL, cannot resolve `@/components/question-panel`.

- [ ] **Step 7: Implement `apps/web/src/components/question-panel.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { AnswerCard } from '@/components/answer-card';
import { EmptyState, Spinner } from '@/components/states';
import { ALERT, BUTTON, BUTTON_SECONDARY, CARD, INPUT } from '@/components/styles';
import { apiFetch, messageOf } from '@/lib/api';
import type { Question } from '@/lib/types';

const MAX_QUESTION_CHARS = 1000;

type Props = { documentId: string; initialQuestions: Question[] };

export function QuestionPanel({ documentId, initialQuestions }: Props) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [draft, setDraft] = useState('');
  // The question being answered right now, shown in the "Thinking" card
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const trimmed = draft.trim();

  async function ask() {
    if (!trimmed || pending) return;
    setError(null);
    setPending(trimmed);
    try {
      const answer = await apiFetch<Question>(`/documents/${documentId}/questions`, {
        method: 'POST',
        json: { question: trimmed },
      });
      setQuestions((current) => [...current, answer]);
      setDraft('');
    } catch (cause) {
      // The draft is kept so the user can retry or edit it
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  function reask(text: string) {
    setDraft(text);
    input.current?.focus();
  }

  return (
    <div className="space-y-6">
      <form
        className={`${CARD} space-y-3`}
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label className="block text-sm font-medium">
          Your question
          <textarea
            ref={input}
            rows={3}
            maxLength={MAX_QUESTION_CHARS}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={INPUT}
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Answers are generated by AI from your document. Check the sources before relying on them.
          </p>
          <button type="submit" disabled={pending !== null || !trimmed} className={BUTTON}>
            {pending ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>

      {error && (
        <div role="alert" className={`${ALERT} flex items-center justify-between gap-4`}>
          <span>{error}</span>
          <button type="button" onClick={() => void ask()} className={BUTTON_SECONDARY}>
            Try again
          </button>
        </div>
      )}

      {pending && (
        <article className={`${CARD} space-y-3`}>
          <h3 className="font-medium">{pending}</h3>
          <Spinner label="Thinking" />
        </article>
      )}

      {questions.length === 0 && !pending && (
        <EmptyState title="Ask your first question" hint="The answer will cite the passages it was taken from." />
      )}

      <div className="space-y-4">
        {[...questions].reverse().map((question) => (
          <AnswerCard key={question.id} question={question} onReask={reask} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test src/components/question-panel.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 9: Create `apps/web/src/app/documents/[id]/page.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { QuestionPanel } from '@/components/question-panel';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState, Spinner } from '@/components/states';
import { apiFetch } from '@/lib/api';
import type { DocumentSummary, Question } from '@/lib/types';
import { useLoad } from '@/lib/use-load';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireAuth>
      <DocumentView id={id} />
    </RequireAuth>
  );
}

function DocumentView({ id }: { id: string }) {
  const load = useCallback(async () => {
    const [document, questions] = await Promise.all([
      apiFetch<DocumentSummary>(`/documents/${id}`),
      apiFetch<Question[]>(`/documents/${id}/questions`),
    ]);
    return { document, questions };
  }, [id]);
  const { data, error, loading, reload } = useLoad(load);

  return (
    <div className="space-y-6">
      <Link href="/documents" className="text-sm font-medium text-blue-700 hover:underline">
        ← All documents
      </Link>

      {loading && <Spinner label="Loading document" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <>
          <section>
            <h1 className="text-2xl font-semibold break-words">{data.document.title}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {data.document.charCount.toLocaleString()} characters in {data.document.chunkCount}{' '}
              {data.document.chunkCount === 1 ? 'passage' : 'passages'}. Each question is answered on its own, so
              include the context it needs.
            </p>
          </section>
          <QuestionPanel documentId={id} initialQuestions={data.questions} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Run all checks and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd ../..
git add apps/web
git commit -m "feat(web): add question page with answer status, sources and retry"
```

Expected: all four succeed, with 33 tests passing and `/documents/[id]` listed in the build output.

---

### Task 5: Docker, Compose and the browser check

**Files:**
- Create: `apps/web/Dockerfile`, `apps/web/.dockerignore`
- Modify: `docker-compose.yml`, `README.md`, `docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md`

**Interfaces:**
- Consumes: the built app from Tasks 1 to 4; the `api` service and its health check from Plan 1.
- Produces: a `web` service on port 3000, so `docker compose up --build` starts the whole product.

- [ ] **Step 1: Create `apps/web/.dockerignore`**

```gitignore
node_modules
.next
.env*
*.log
*.tsbuildinfo
AGENTS.md
CLAUDE.md
```

- [ ] **Step 2: Create `apps/web/Dockerfile`**

```dockerfile
FROM node:24-slim AS base
# Keeps pnpm non-interactive and Next.js quiet
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Inlined into the browser bundle at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm build

FROM node:24-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Add the `web` service to `docker-compose.yml`**

Add this service after `api` and before `volumes`:

```yaml
  web:
    build:
      context: ./apps/web
      args:
        # The browser calls the API directly, so this is the address as seen from the host
        NEXT_PUBLIC_API_URL: http://localhost:3001/api
    ports:
      - "3000:3000"
    depends_on:
      api:
        condition: service_healthy
```

- [ ] **Step 4: Start the whole stack**

The root `.env` must have `LLM_PROVIDER=mock` for this step.

```bash
docker compose up -d --build
curl -s --retry 20 --retry-all-errors --retry-delay 2 -o /dev/null -w 'web %{http_code}\n' localhost:3000/login
curl -s -o /dev/null -w 'api %{http_code}\n' localhost:3001/api/health
docker compose ps --format '{{.Service}} {{.Status}}'
```

Expected: `web 200`, `api 200`, and the three services running, with `db` and `api` healthy.

- [ ] **Step 5: Drive the app in a real browser**

Only a browser exercises CORS, `localStorage`, hydration and the redirects together. This script is a throwaway check and is not committed. Run it from the scratchpad directory:

```bash
mkdir -p ui-smoke && cd ui-smoke
pnpm init > /dev/null && pnpm add playwright > /dev/null && pnpm exec playwright install chromium
cat > smoke.mjs <<'EOF'
import { chromium } from 'playwright';

const base = 'http://localhost:3000';
const email = `ui-${Date.now()}@example.com`;
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => errors.push(`page error: ${error}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console error: ${message.text()}`);
});

const step = async (name, action) => {
  await action();
  console.log(`ok  ${name}`);
};

await step('anonymous visit lands on the login page', async () => {
  await page.goto(base);
  await page.waitForURL('**/login');
});

await step('sign up', async () => {
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.waitForURL('**/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/documents');
  await page.getByText('Upload your first document').waitFor();
  await page.getByText(email).waitFor();
});

await step('upload pasted text', async () => {
  await page.getByRole('button', { name: 'Paste text' }).click();
  await page.getByLabel('Text').fill('Paris is the capital of France. Berlin is the capital of Germany.');
  await page.getByRole('button', { name: 'Upload document' }).click();
  await page.getByRole('link', { name: /Paris is the capital/ }).waitFor();
});

await step('open the document and see the empty state', async () => {
  await page.getByRole('link', { name: /Paris is the capital/ }).click();
  await page.waitForURL('**/documents/*');
  await page.getByText('Ask your first question').waitFor();
});

await step('ask a question and get a grounded answer', async () => {
  await page.getByLabel('Your question').fill('What is the capital of France?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByText('Answered from the document').waitFor();
  await page.getByRole('button', { name: 'Show sources (1)' }).click();
  await page.getByText('Passage 1').waitFor();
});

await step('the session and the history survive a reload', async () => {
  await page.reload();
  await page.getByText('Answered from the document').waitFor();
});

await step('edit and ask again fills the form', async () => {
  await page.getByRole('button', { name: 'Edit and ask again' }).click();
  const value = await page.getByLabel('Your question').inputValue();
  if (value !== 'What is the capital of France?') throw new Error(`unexpected draft: ${value}`);
});

await step('sign out returns to the login page', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
});

await step('a protected page redirects an anonymous visitor', async () => {
  await page.goto(`${base}/documents`);
  await page.waitForURL('**/login');
});

await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console or page errors');
process.exit(errors.length ? 1 : 0);
EOF
node smoke.mjs
```

Expected: nine `ok` lines and `no console or page errors`, with exit code 0.

If Chromium cannot be installed on this machine, skip this step, say so plainly in the final message, and ask for a manual pass through the same nine steps.

- [ ] **Step 6: Update the README**

In `README.md`, replace the sentence `The API listens on http://localhost:3001/api.` with:

```markdown
Open http://localhost:3000, create an account, upload a document and ask a
question about it. The API listens on http://localhost:3001/api.
```

In the "Develop without Docker" block, add the frontend commands after the API ones:

```bash
cd ../web
pnpm install
pnpm dev         # http://localhost:3000
pnpm test
```

In the "Architecture" section, replace the first sentence with:

```markdown
A Next.js frontend, a modular NestJS monolith, PostgreSQL with pgvector, and
Docker Compose.
```

Add this section after "Limits":

```markdown
## Frontend

A client-rendered Next.js app with four screens: sign in, sign up, the document
list with upload, and the question page of one document.

| Concern | How it is handled |
|---|---|
| Model status | A pending card shows the question and "Thinking" until the answer arrives |
| Uncertainty | Each answer carries a status badge; `unverified` adds a warning and `not_found` suggests rephrasing |
| Sources | Each answer can expand the passages it cited |
| Refine or re-ask | "Edit and ask again" copies a past question into the form |
| Errors | Every request has an error state with a retry; a rate limit has its own message and keeps the question |
| Empty states | "Upload your first document" and "Ask your first question" |
| Unsafe output | Model output is rendered as plain text, never as HTML or Markdown |

There are no partial results: without streaming the answer arrives whole, so the
UI shows "Thinking" until then.

The token is kept in `localStorage`, which is simple but readable by any script
on the page. The production alternative is an `httpOnly` cookie.
```

- [ ] **Step 7: Align the spec with what was built**

In the spec, section 2, replace the out-of-scope line `- Frontend automated tests.` with:

```markdown
- Frontend end-to-end tests in the repository.
```

In section 11, add this row to the table:

```markdown
| Frontend API client and stateful components | Unit, Vitest and Testing Library | Session expiry, error messages, loading, model status, answer statuses, retry |
```

In section 13, replace the `Token in localStorage` row's first cell so it reads `Token in localStorage, read with useSyncExternalStore`.

- [ ] **Step 8: Check the README commands and commit**

```bash
cd apps/web && pnpm lint && pnpm typecheck && pnpm test && cd ../..
git add apps/web docker-compose.yml README.md docs/superpowers/specs
git commit -m "feat(web): add Docker image and run the full stack with Compose"
```

Expected: the checks pass with 33 tests.

**Checkpoint:** stop here. The product runs end to end with `docker compose up --build`. Review Tasks 3 to 5 in the browser, then write Plan 3 (Terraform, README and delivery).

---

## Deferred to Plan 3

- Terraform for AWS, with the frontend built with `NEXT_PUBLIC_API_URL=/api` behind the load balancer.
- `DB_SSL` and the RDS certificate bundle; `trust proxy` for client IPs behind the load balancer; `API_DOCS_ENABLED=false` in production.
- README sections on data handling, PII, logging, auditability, evaluation, infrastructure, secrets, scaling, the cost table and known limitations.
- Clean-clone verification and the final delivery checks.
