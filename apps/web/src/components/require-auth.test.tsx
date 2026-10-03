import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/require-auth';
import { apiFetch, tokenStore } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => '/documents/d-1',
}));

function renderProtected() {
  return render(
    <AuthProvider>
      <RequireAuth>
        <p>secret page</p>
      </RequireAuth>
    </AuthProvider>,
  );
}

beforeEach(() => {
  mocks.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('RequireAuth', () => {
  it('sends an anonymous visitor to the login page, remembering where they were going', async () => {
    renderProtected();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login?next=%2Fdocuments%2Fd-1'));
    expect(screen.queryByText('secret page')).toBeNull();
  });

  it('shows the page to a signed-in user', async () => {
    tokenStore.set('a-token');
    renderProtected();
    expect(await screen.findByText('secret page')).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('leaves the page and returns to the login page when the user signs out', async () => {
    tokenStore.set('a-token');
    renderProtected();
    await screen.findByText('secret page');

    act(() => tokenStore.clear());

    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login?next=%2Fdocuments%2Fd-1'));
    expect(screen.queryByText('secret page')).toBeNull();
  });

  it('leaves the page and says the session expired when the API answers 401', async () => {
    tokenStore.set('a-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Invalid or expired token"}', { status: 401 })));
    renderProtected();
    await screen.findByText('secret page');

    await act(async () => {
      await apiFetch('/documents').catch(() => undefined);
    });

    await vi.waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/login?next=%2Fdocuments%2Fd-1&expired=1'),
    );
    expect(screen.queryByText('secret page')).toBeNull();
  });
});
