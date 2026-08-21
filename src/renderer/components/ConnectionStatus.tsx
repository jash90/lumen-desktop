import type { ConnectionStatus as Status } from '../../shared/models';

const LABELS: Record<Status['state'], string> = {
  connected: 'Połączono',
  connecting: 'Łączenie…',
  reconnecting: 'Ponawianie…',
  disconnected: 'Brak połączenia',
};

const DOT_CLASSES: Record<Status['state'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-danger',
};

/** The status indicator from PRD §7 / §25. */
export function ConnectionStatusBadge({ status }: { status: Status | undefined }) {
  const state = status?.state ?? 'connecting';
  const retrySeconds = status?.retryInMs ? Math.round(status.retryInMs / 1000) : null;

  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-line/50 px-2 py-1 text-xs font-medium text-ink-muted"
      role="status"
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[state]}`} />
      {LABELS[state]}
      {state === 'reconnecting' && retrySeconds !== null && ` (${retrySeconds} s)`}
    </span>
  );
}
