import { ALERT, BUTTON_SECONDARY } from '@/components/styles';

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      {label}…
    </p>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{hint}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={`${ALERT} flex items-center justify-between gap-4`}>
      <span>{message}</span>
      <button type="button" onClick={onRetry} className={BUTTON_SECONDARY}>
        Try again
      </button>
    </div>
  );
}
