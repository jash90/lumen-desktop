import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: { label: string; onClick(): void };
}

/**
 * Empty, offline and not-found messages share one shape, so the app explains
 * itself the same way everywhere instead of dropping a bare paragraph.
 */
export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="enter flex flex-col items-center px-8 py-14 text-center">
      {icon && <div className="mb-4 text-ink-muted opacity-60">{icon}</div>}
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="mt-1.5 text-sm text-balance text-ink-muted">{description}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 min-h-9 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-105 focus-visible:focus-ring"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
