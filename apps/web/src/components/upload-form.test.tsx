import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadForm } from '@/components/upload-form';
import { ApiError, apiFetch } from '@/lib/api';
import type { DocumentSummary } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const created: DocumentSummary = {
  id: 'd-1',
  title: 'Notes',
  sourceType: 'pasted',
  charCount: 11,
  chunkCount: 1,
  createdAt: '2026-10-04T12:00:00.000Z',
};

const submitButton = () => screen.getByRole('button', { name: /Upload document|Processing document/ }) as HTMLButtonElement;

function pasteText(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Paste text' }));
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: text } });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('UploadForm', () => {
  it('keeps the button disabled until there is something to upload', () => {
    render(<UploadForm onCreated={vi.fn()} />);
    expect(submitButton().disabled).toBe(true);

    pasteText('   ');
    expect(submitButton().disabled).toBe(true);

    pasteText('hello world');
    expect(submitButton().disabled).toBe(false);
  });

  it('shows a processing state while uploading, then reports the new document', async () => {
    let finish: (document: DocumentSummary) => void = () => {};
    apiFetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onCreated = vi.fn();
    render(<UploadForm onCreated={onCreated} />);

    pasteText('hello world');
    fireEvent.click(submitButton());

    expect(submitButton().textContent).toBe('Processing document…');
    expect(submitButton().disabled).toBe(true);
    const [path, options] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/documents');
    expect((options?.formData as FormData).get('text')).toBe('hello world');

    finish(created);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect((screen.getByLabelText('Text') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows the error and lets the user try again', async () => {
    apiFetchMock.mockRejectedValue(new ApiError(413, 'The document has 60000 characters and the limit is 50000'));
    const onCreated = vi.fn();
    render(<UploadForm onCreated={onCreated} />);

    pasteText('hello world');
    fireEvent.click(submitButton());

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The document has 60000 characters and the limit is 50000',
    );
    expect(submitButton().disabled).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
