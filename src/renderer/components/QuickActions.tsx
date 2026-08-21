import { useQuickActions, useRunAction } from '../hooks/useHue';

/** One-click commands the user pinned, sitting above the room list. */
export function QuickActions() {
  const quickActions = useQuickActions();
  const run = useRunAction();

  if (quickActions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {quickActions.map((quickAction) => (
        <button
          key={quickAction.id}
          type="button"
          onClick={() => run.mutate(quickAction.action)}
          className="min-h-8 rounded-full border border-line px-3 text-xs font-medium text-ink transition-colors hover:bg-line/40 focus-visible:focus-ring"
        >
          {quickAction.label}
        </button>
      ))}
    </div>
  );
}
