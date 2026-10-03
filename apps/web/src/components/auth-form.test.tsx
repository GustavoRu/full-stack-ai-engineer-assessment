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
