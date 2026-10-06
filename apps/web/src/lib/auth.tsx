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
