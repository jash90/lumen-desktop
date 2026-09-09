import { PRODUCT_NAME } from '../../shared/identity';
import { AddHub } from '../components/AddHub';
import { useStorageHealth } from '../hooks/useLighting';

/**
 * First-run flow (PRD §5, §22, §40).
 *
 * The connecting itself lives in AddHub, shared with the settings screen: "your
 * first hub" and "another hub" are the same job, and with hubs running side by
 * side the second is now the common case.
 */
export function OnboardingPage() {
  const health = useStorageHealth();

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-12 pb-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Connect a Hue Bridge, or a Home Assistant instance for every other brand in the house.
        </p>
      </header>

      <AddHub />

      {health.data?.weak && (
        <p className="mt-6 rounded-card border-l-4 border-amber-500 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          This system provides no secure password storage
          {health.data.backend ? ` (backend: ${health.data.backend})` : ''}. Credentials will not be
          saved and you will have to connect again after a restart.
        </p>
      )}
    </div>
  );
}
