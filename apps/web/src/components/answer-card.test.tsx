import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnswerCard } from '@/components/answer-card';
import type { Question } from '@/lib/types';

const base: Question = {
  id: 'q-1',
  question: 'How much notice is needed?',
  answer: 'Thirty days of written notice.',
  status: 'answered',
  citations: [{ chunkIndex: 4, content: 'The contract can be terminated with 30 days written notice.' }],
  usage: { inputTokens: 230, outputTokens: 37 },
  model: 'gemini-3.1-flash-lite',
  promptVersion: 'qa-v1',
  mode: 'classic',
  searches: [],
  modelCalls: 1,
  createdAt: '2026-10-04T12:00:00.000Z',
};

describe('AnswerCard', () => {
  it('shows a grounded answer and reveals its sources on demand', () => {
    render(<AnswerCard question={base} onReask={vi.fn()} />);

    expect(screen.getByText('Thirty days of written notice.')).toBeTruthy();
    expect(screen.getByText('Answered from the document')).toBeTruthy();
    expect(screen.queryByText(/30 days written notice/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show sources (1)' }));
    expect(screen.getByText('Passage 5')).toBeTruthy();
    expect(screen.getByText(/30 days written notice/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide sources' }));
    expect(screen.queryByText(/30 days written notice/)).toBeNull();
  });

  it('warns when the answer could not be tied to the document', () => {
    render(<AnswerCard question={{ ...base, status: 'unverified', citations: [] }} onReask={vi.fn()} />);

    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText(/could not be tied to a passage/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sources/ })).toBeNull();
  });

  it('suggests rephrasing when the document does not cover the question', () => {
    const question: Question = { ...base, status: 'not_found', answer: 'The document does not cover this.', citations: [] };
    render(<AnswerCard question={question} onReask={vi.fn()} />);

    expect(screen.getByText('Not in the document')).toBeTruthy();
    expect(screen.getByText(/Try rephrasing/)).toBeTruthy();
  });

  it('hands the question back to be edited and asked again', () => {
    const onReask = vi.fn();
    render(<AnswerCard question={base} onReask={onReask} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit and ask again' }));
    expect(onReask).toHaveBeenCalledWith('How much notice is needed?');
  });

  it('renders model output as text, never as markup', () => {
    const answer = '<img src=x onerror="alert(1)"> **bold** <b>tag</b>';
    const { container } = render(<AnswerCard question={{ ...base, answer }} onReask={vi.fn()} />);

    expect(screen.getByText(answer)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows the model, prompt version and token count', () => {
    render(<AnswerCard question={base} onReask={vi.fn()} />);
    expect(screen.getByText('gemini-3.1-flash-lite · qa-v1 · 267 tokens')).toBeTruthy();
  });

  it('lists what the model searched for in an agentic answer, as text', () => {
    const question: Question = {
      ...base,
      mode: 'agentic',
      promptVersion: 'agent-v1',
      modelCalls: 3,
      searches: [
        { query: 'notice period', sourceCount: 3 },
        { query: '<b>termination</b> fees', sourceCount: 1 },
      ],
    };
    const { container } = render(<AnswerCard question={question} onReask={vi.fn()} />);

    expect(screen.getByText('Searched for:')).toBeTruthy();
    expect(screen.getByText(/notice period/)).toBeTruthy();
    expect(screen.getByText('(3 passages)')).toBeTruthy();
    expect(screen.getByText('(1 passage)')).toBeTruthy();
    expect(screen.getByText(/<b>termination<\/b> fees/)).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('gemini-3.1-flash-lite · agent-v1 · 267 tokens · 3 model calls')).toBeTruthy();
  });

  it('shows no search list for a classic answer', () => {
    render(<AnswerCard question={base} onReask={vi.fn()} />);
    expect(screen.queryByText('Searched for:')).toBeNull();
  });
});
