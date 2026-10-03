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
