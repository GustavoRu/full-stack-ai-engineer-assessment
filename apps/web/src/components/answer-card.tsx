'use client';

import { useState } from 'react';
import { BUTTON_SECONDARY, CARD } from '@/components/styles';
import type { AnswerStatus, Question } from '@/lib/types';

const STATUS: Record<AnswerStatus, { label: string; badge: string }> = {
  answered: { label: 'Answered from the document', badge: 'bg-emerald-100 text-emerald-800' },
  unverified: { label: 'Not verified', badge: 'bg-amber-100 text-amber-800' },
  not_found: { label: 'Not in the document', badge: 'bg-slate-200 text-slate-700' },
};

const NOTE: Partial<Record<AnswerStatus, string>> = {
  unverified: 'This answer could not be tied to a passage of the document. Check it before relying on it.',
  not_found: 'The document does not seem to cover this. Try rephrasing the question or asking something more specific.',
};

type Props = { question: Question; onReask: (text: string) => void };

export function AnswerCard({ question, onReask }: Props) {
  const [showSources, setShowSources] = useState(false);
  const status = STATUS[question.status];
  const note = NOTE[question.status];
  const totalTokens = question.usage.inputTokens + question.usage.outputTokens;

  return (
    <article className={`${CARD} space-y-3`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium">{question.question}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.badge}`}>{status.label}</span>
      </header>

      {/* Plain text on purpose: model output is never rendered as HTML or Markdown */}
      <p className="whitespace-pre-wrap text-sm leading-6">{question.answer}</p>

      {note && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{note}</p>}

      {question.citations.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={showSources}
            onClick={() => setShowSources((visible) => !visible)}
            className={BUTTON_SECONDARY}
          >
            {showSources ? 'Hide sources' : `Show sources (${question.citations.length})`}
          </button>
          {showSources && (
            <ol className="space-y-2">
              {question.citations.map((citation) => (
                <li key={citation.chunkIndex} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Passage {citation.chunkIndex + 1}</p>
                  <blockquote className="mt-1 whitespace-pre-wrap text-sm">{citation.content}</blockquote>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={() => onReask(question.question)} className={BUTTON_SECONDARY}>
          Edit and ask again
        </button>
        <span className="text-xs text-slate-500">
          {question.model} · {question.promptVersion} · {totalTokens} tokens
        </span>
      </footer>
    </article>
  );
}
