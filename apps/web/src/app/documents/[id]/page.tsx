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
