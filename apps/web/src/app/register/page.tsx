import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';

// The form reads the address, which needs a Suspense boundary for the static page
export default function RegisterPage() {
  return (
    <Suspense>
      <AuthForm mode="register" />
    </Suspense>
  );
}
