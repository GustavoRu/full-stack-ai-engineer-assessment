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
