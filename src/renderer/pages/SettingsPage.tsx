import { useQueryClient } from '@tanstack/react-query';

import type { ThemePreference } from '../../shared/models';
import {
  useConnectionStatus,
  useSettings,
  useStorageHealth,
  useUpdateSettings,
} from '../hooks/useHue';
import { queryKeys, unwrap } from '../lib/hue';
import { useUiStore } from '../stores/uiStore';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Systemowy',
  light: 'Jasny',
  dark: 'Ciemny',
};

/** Settings from PRD §29, minus the startup/tray options which are P1. */
export function SettingsPage() {
  const status = useConnectionStatus();
  const settings = useSettings();
  const health = useStorageHealth();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const goHome = useUiStore((state) => state.goHome);

  const bridge = status.data?.bridge;

  return (
    <div className="space-y-6 px-4 py-4 pb-6">
      <h1 className="px-1 text-lg font-semibold tracking-tight">Ustawienia</h1>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Bridge</h2>
        {bridge ? (
          <div className="card-stack p-4">
            <p className="text-sm font-medium">{bridge.name}</p>
            <p className="text-xs text-ink-muted">
              {bridge.ip} · {bridge.id}
            </p>
            {bridge.swVersion && (
              <p className="mt-1 text-xs text-ink-muted">Firmware {bridge.swVersion}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Brak sparowanego Bridge.</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              const next = await unwrap(window.hue.reconnectBridge());
              queryClient.setQueryData(queryKeys.connection, next);
            }}
            className="min-h-9 flex-1 rounded-row border border-line px-4 text-sm transition-colors hover:bg-line/40 focus-visible:focus-ring"
          >
            Połącz ponownie
          </button>
          <button
            type="button"
            onClick={async () => {
              await unwrap(window.hue.disconnectBridge());
              await queryClient.invalidateQueries();
              goHome();
            }}
            className="min-h-9 flex-1 rounded-row border border-danger/40 px-4 text-sm text-danger transition-colors hover:bg-danger/10 focus-visible:focus-ring"
          >
            Zapomnij Bridge
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Wygląd</h2>
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

      {health.data?.weak && (
        <section className="rounded-card border-l-4 border-amber-500 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400">
          <p className="font-medium">Słabe zabezpieczenie danych logowania</p>
          <p className="mt-1">
            System nie udostępnia pełnego magazynu haseł
            {health.data.backend ? ` (backend: ${health.data.backend})` : ''}. Klucz aplikacji jest
            zapisany z minimalną ochroną — rozważ instalację GNOME Keyring lub KWallet.
          </p>
        </section>
      )}
    </div>
  );
}
