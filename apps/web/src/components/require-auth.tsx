'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Renders its children only for a signed-in user; anyone else goes to the login page
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!hydrated || token) return;
    // The login page returns the user here afterwards, and says so when the session expired
    const params = new URLSearchParams({ next: pathname });
    if (tokenStore.consumeExpired()) params.set('expired', '1');
    router.replace(`/login?${params}`);
  }, [hydrated, token, router, pathname]);

  if (!hydrated || !token) return null;
  return <>{children}</>;
}
