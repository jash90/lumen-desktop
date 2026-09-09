import type { ConnectionState, ThemePreference } from '../../shared/models';
import {
  useAnyConnected,
  useConnectionStatuses,
  useHubs,
  useReconnectHubs,
  useRemoveHub,
  useSettings,
  useStorageHealth,
  useUpdateSettings,
} from '../hooks/useLighting';
import { ActionEditor } from '../components/ActionEditor';
import { PowerSwitch } from '../components/PowerSwitch';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const STATE_LABELS: Record<ConnectionState, string> = {
  connected: 'connected',
  connecting: 'connecting…',
  reconnecting: 'retrying…',
  disconnected: 'offline',
};

const STATE_DOTS: Record<ConnectionState, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  reconnecting: 'bg-amber-500',
  disconnected: 'bg-danger',
};

/** Settings from PRD §29, minus the startup/tray options which are P1. */
export function SettingsPage() {
  const statuses = useConnectionStatuses();
  const anyConnected = useAnyConnected();
  const settings = useSettings();
  const health = useStorageHealth();
  const updateSettings = useUpdateSettings();

  const hubs = useHubs();
  const reconnect = useReconnectHubs();
  const removeHub = useRemoveHub();
  const known = hubs.data ?? [];

  /** Hubs run side by side, so each carries its own state rather than one badge. */
  const stateOf = (id: string): ConnectionState =>
    statuses.data?.find((status) => status.providerId === id)?.state ?? 'disconnected';

  return (
    <div className="space-y-6 px-4 py-4 pb-6">
      <h1 className="px-1 text-lg font-semibold tracking-tight">Settings</h1>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Hubs</h2>
        {known.length > 0 ? (
          <div className="card-stack divide-y divide-line">
            {known.map((entry) => {
              const state = stateOf(entry.id);
              return (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOTS[state]}`}
                      />
                      <span className="truncate text-sm font-medium">{entry.name}</span>
                    </span>
                    <span className="block truncate pl-3.5 text-xs text-ink-muted">
                      {entry.address}
                      {entry.swVersion ? ` · firmware ${entry.swVersion}` : ''}
                      {` · ${STATE_LABELS[state]}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeHub.mutate(entry.id)}
                    aria-label={`Remove ${entry.name}`}
                    className="min-h-8 rounded-row px-2 text-sm text-ink-muted transition-colors hover:text-danger focus-visible:focus-ring"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No hub connected.</p>
        )}

        <button
          type="button"
          onClick={() => reconnect.mutate()}
          className="min-h-9 w-full rounded-row border border-line px-4 text-sm transition-colors hover:bg-line/40 focus-visible:focus-ring"
        >
          Reconnect all
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Appearance</h2>
        <div className="flex gap-2">
          {(Object.keys(THEME_LABELS) as ThemePreference[]).map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => updateSettings.mutate({ theme })}
              aria-pressed={settings.data?.theme === theme}
              className={`min-h-9 flex-1 rounded-row border px-3 text-sm transition-colors focus-visible:focus-ring ${
                settings.data?.theme === theme
                  ? 'border-accent bg-accent/10 font-medium text-ink'
                  : 'border-line text-ink-muted hover:text-ink'
              }`}
            >
              {THEME_LABELS[theme]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Quick actions and shortcuts</h2>
        <ActionEditor connected={anyConnected} />
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Startup</h2>
        <div className="card-stack flex items-center gap-3 p-4">
          <span className="min-w-0 flex-1 text-sm">
            Launch at login
            <span className="mt-0.5 block text-xs text-ink-muted">
              The app starts in the background, available from the menu bar.
            </span>
          </span>
          <PowerSwitch
            checked={settings.data?.launchAtLogin ?? false}
            label="Launch at login"
            onCheckedChange={(launchAtLogin) => updateSettings.mutate({ launchAtLogin })}
          />
        </div>
      </section>

      {health.data?.weak && (
        <section className="rounded-card border-l-4 border-amber-500 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400">
          <p className="font-medium">Weak credential protection</p>
          <p className="mt-1">
            This system provides no full password storage
            {health.data.backend ? ` (backend: ${health.data.backend})` : ''}. The application key is
            stored with minimal protection — consider installing GNOME Keyring or KWallet.
          </p>
        </section>
      )}
    </div>
  );
}
