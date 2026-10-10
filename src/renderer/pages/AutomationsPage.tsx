import { useAutomations, useSetAutomationEnabled } from '../hooks/useLighting';
import { EmptyState } from '../components/EmptyState';
import { PowerSwitch } from '../components/PowerSwitch';
import { Skeleton } from '../components/Skeleton';
import { useT } from '../i18n';

/**
 * Automations created in the Philips Hue app.
 *
 * Deliberately read-and-toggle only: every behaviour script carries its own
 * configuration schema, so building one is a project of its own — and the bridge
 * runs these whether or not this app is open, which is the point.
 */
export function AutomationsPage({ connected }: { connected: boolean }) {
  const automations = useAutomations(connected);
  const setEnabled = useSetAutomationEnabled();
  const t = useT();

  if (automations.isLoading) {
    return (
      <div className="space-y-2 px-4 py-4" aria-busy="true" aria-label={t('automations.loading')}>
        <div className="card-stack divide-y divide-line">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-40 flex-1" />
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const list = automations.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        title={t('automations.emptyTitle')}
        description={t('automations.emptyDescription')}
      />
    );
  }

  return (
    <div className="space-y-3 px-4 py-4 pb-6">
      <p className="px-1 text-xs text-ink-muted">
        {t('automations.runOnBridge')}
      </p>
      <div className="card-stack divide-y divide-line">
        {list.map((automation) => (
          <div key={automation.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{automation.name}</p>
              <p className="text-xs text-ink-muted">
                {automation.enabled ? t('automations.active') : t('automations.paused')}
              </p>
            </div>
            <PowerSwitch
              checked={automation.enabled}
              label={t('automations.toggleNamed', { name: automation.name })}
              onCheckedChange={(enabled) => setEnabled.mutate({ id: automation.id, enabled })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
