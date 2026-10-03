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
