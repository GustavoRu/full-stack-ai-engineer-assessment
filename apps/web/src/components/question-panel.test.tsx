import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionPanel } from '@/components/question-panel';
import { ApiError, apiFetch } from '@/lib/api';
import type { Question } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const answered: Question = {
  id: 'q-1',
  question: 'What is the capital of France?',
  answer: 'Paris.',
  status: 'answered',
  citations: [{ chunkIndex: 0, content: 'Paris is the capital of France.' }],
  usage: { inputTokens: 200, outputTokens: 20 },
  model: 'mock-chat',
  promptVersion: 'qa-v1',
  createdAt: '2026-10-04T12:00:00.000Z',
};

const input = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
const askButton = () => screen.getByRole('button', { name: /^(Ask|Thinking…)$/ }) as HTMLButtonElement;

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('QuestionPanel', () => {
  it('shows an empty state before any question', () => {
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);
    expect(screen.getByText('Ask your first question')).toBeTruthy();
    expect(askButton().disabled).toBe(true);
  });

  it('shows the model thinking, then the answer, and clears the form', async () => {
    let finish: (question: Question) => void = () => {};
    apiFetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);

    type('What is the capital of France?');
    fireEvent.click(askButton());

    expect(screen.getByRole('status').textContent).toContain('Thinking');
    expect(screen.queryByText('Ask your first question')).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledWith('/documents/d-1/questions', {
      method: 'POST',
      json: { question: 'What is the capital of France?' },
    });

    finish(answered);
    expect(await screen.findByText('Paris.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(input().value).toBe('');
  });

  it('sends only one request when the user submits twice', () => {
    apiFetchMock.mockReturnValue(new Promise(() => {}));
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);

    type('What is the capital of France?');
    fireEvent.click(askButton());
    fireEvent.click(askButton());
    fireEvent.submit(input().form as HTMLFormElement);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(askButton().disabled).toBe(true);
  });

  it('keeps the question and offers a retry when the request is rate limited', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(429, 'Limit reached. Try again in a minute.'));
    apiFetchMock.mockResolvedValueOnce(answered);
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);

    type('What is the capital of France?');
    fireEvent.click(askButton());

    expect((await screen.findByRole('alert')).textContent).toContain('Limit reached. Try again in a minute.');
    expect(input().value).toBe('What is the capital of France?');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Paris.')).toBeTruthy();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps what the user typed while waiting for the answer', async () => {
    let finish: (question: Question) => void = () => {};
    apiFetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<QuestionPanel documentId="d-1" initialQuestions={[]} />);

    type('What is the capital of France?');
    fireEvent.click(askButton());
    type('A second question I am already typing');

    finish(answered);
    expect(await screen.findByText('Paris.')).toBeTruthy();
    expect(input().value).toBe('A second question I am already typing');
  });

  it('lists earlier answers newest first', () => {
    const older = { ...answered, id: 'q-0', question: 'Older question?', answer: 'Older answer.' };
    render(<QuestionPanel documentId="d-1" initialQuestions={[older, answered]} />);

    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['What is the capital of France?', 'Older question?']);
  });

  it('copies an earlier question into the form to edit and ask again', async () => {
    render(<QuestionPanel documentId="d-1" initialQuestions={[answered]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit and ask again' }));

    await waitFor(() => expect(input().value).toBe('What is the capital of France?'));
    expect(document.activeElement).toBe(input());
  });
});
