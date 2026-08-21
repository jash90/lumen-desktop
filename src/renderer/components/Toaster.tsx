import { useUiStore } from '../stores/uiStore';

/** Failure feedback for optimistic writes that got rolled back (PRD §24). */
export function Toaster() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2 px-4"
      role="alert"
      aria-live="assertive"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          className="enter pointer-events-auto w-full max-w-sm rounded-card bg-danger px-4 py-2.5 text-left text-sm text-danger-ink shadow-card"
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
