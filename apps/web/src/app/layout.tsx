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
