import { useQueryClient } from '@tanstack/react-query';

import type { ThemePreference } from '../../shared/models';
import {
  useBridges,
  useConnectionStatus,
  useRemoveBridge,
  useSettings,
  useStorageHealth,
  useSwitchBridge,
  useUpdateSettings,
} from '../hooks/useHue';
import { queryKeys, unwrap } from '../lib/hue';
import { ActionEditor } from '../components/ActionEditor';
import { PowerSwitch } from '../components/PowerSwitch';
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
  const bridges = useBridges();
  const switchBridge = useSwitchBridge();
  const removeBridge = useRemoveBridge();
  const known = bridges.data ?? [];

  return (
    <div className="space-y-6 px-4 py-4 pb-6">
      <h1 className="px-1 text-lg font-semibold tracking-tight">Ustawienia</h1>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Bridge</h2>
        {known.length > 0 ? (
          <div className="card-stack divide-y divide-line">
            {known.map((entry) => {
              const active = entry.id === bridge?.id;
              return (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => !active && switchBridge.mutate(entry.id)}
                    aria-pressed={active}
                    className="min-w-0 flex-1 rounded-row text-left focus-visible:focus-ring"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          active ? 'bg-accent' : 'bg-line'
                        }`}
                      />
                      <span className="truncate text-sm font-medium">{entry.name}</span>
                    </span>
                    <span className="block truncate pl-3.5 text-xs text-ink-muted">
                      {entry.ip}
                      {entry.swVersion ? ` · firmware ${entry.swVersion}` : ''}
                      {active ? ' · aktywny' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBridge.mutate(entry.id)}
                    aria-label={`Usuń ${entry.name}`}
                    className="min-h-8 rounded-row px-2 text-sm text-ink-muted transition-colors hover:text-danger focus-visible:focus-ring"
                  >
                    Usuń
                  </button>
                </div>
              );
            })}
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
            Zapomnij aktywny
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

      <section className="space-y-3">
        <h2 className="label-caps px-1">Szybkie akcje i skróty</h2>
        <ActionEditor connected={status.data?.state === 'connected'} />
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Uruchamianie</h2>
        <div className="card-stack flex items-center gap-3 p-4">
          <span className="min-w-0 flex-1 text-sm">
            Uruchamiaj przy starcie systemu
            <span className="mt-0.5 block text-xs text-ink-muted">
              Aplikacja wystartuje w tle, dostępna z paska menu.
            </span>
          </span>
          <PowerSwitch
            checked={settings.data?.launchAtLogin ?? false}
            label="Uruchamiaj przy starcie systemu"
            onCheckedChange={(launchAtLogin) => updateSettings.mutate({ launchAtLogin })}
          />
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
