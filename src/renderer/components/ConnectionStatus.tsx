import type { ConnectionStatus as Status } from '../../shared/models';

const LABELS: Record<Status['state'], string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Retrying…',
  disconnected: 'Disconnected',
};

const DOT_CLASSES: Record<Status['state'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-danger',
};

/** Worst first, so the summary can never hide a hub that has dropped. */
const SEVERITY: Status['state'][] = ['disconnected', 'reconnecting', 'connecting', 'connected'];

/**
 * The status indicator from PRD §7 / §25, over however many hubs are configured.
 *
 * The count only appears once there is more than one, so the single-hub case
 * reads exactly as it did before.
 */
export function ConnectionStatusBadge({ statuses }: { statuses: readonly Status[] }) {
  const worst = [...statuses].sort(
    (a, b) => SEVERITY.indexOf(a.state) - SEVERITY.indexOf(b.state),
  )[0];

  const state = worst?.state ?? 'connecting';
  const retrySeconds = worst?.retryInMs ? Math.round(worst.retryInMs / 1000) : null;
  const connected = statuses.filter((entry) => entry.state === 'connected').length;

  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-line/50 px-2 py-1 text-xs font-medium text-ink-muted"
      role="status"
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[state]}`} />
      {LABELS[state]}
      {statuses.length > 1 && ` ${connected}/${statuses.length}`}
      {state === 'reconnecting' && retrySeconds !== null && ` (${retrySeconds} s)`}
    </span>
  );
}
