import Link from 'next/link';
import type { DocumentSummary, SourceType } from '@/lib/types';

const SOURCE_LABEL: Record<SourceType, string> = {
  pdf: 'PDF',
  text: 'Text file',
  markdown: 'Markdown',
  pasted: 'Pasted text',
};

type Props = { documents: DocumentSummary[]; onDelete: (id: string) => void };

export function DocumentList({ documents, onDelete }: Props) {
  return (
    <ul className="space-y-2">
      {documents.map((document) => (
        <li
          key={document.id}
          className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="min-w-0">
            <Link
              href={`/documents/${document.id}`}
              className="block truncate font-medium text-blue-700 hover:underline"
            >
              {document.title}
            </Link>
            <p className="text-xs text-slate-500">
              {SOURCE_LABEL[document.sourceType]} · {document.chunkCount}{' '}
              {document.chunkCount === 1 ? 'passage' : 'passages'} ·{' '}
              {new Date(document.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Delete ${document.title}`}
            onClick={() => onDelete(document.id)}
            className="text-sm text-red-700 hover:underline"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
