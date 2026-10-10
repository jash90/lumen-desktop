import { useState } from 'react';

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
import { AddHub } from '../components/AddHub';
import { PowerSwitch } from '../components/PowerSwitch';
import { UpdateCard } from '../components/UpdateCard';
import { useT } from '../i18n';
import type { MessageKey } from '../../shared/i18n';

const THEME_LABELS: Record<ThemePreference, MessageKey> = {
  system: 'settings.theme.system',
  light: 'settings.theme.light',
  dark: 'settings.theme.dark',
};

const STATE_LABELS: Record<ConnectionState, MessageKey> = {
  connected: 'settings.hubState.connected',
  connecting: 'settings.hubState.connecting',
  reconnecting: 'settings.hubState.reconnecting',
  disconnected: 'settings.hubState.disconnected',
};

const STATE_DOTS: Record<ConnectionState, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  reconnecting: 'bg-amber-500',
  disconnected: 'bg-danger',
};

/** Settings from PRD §29, minus the startup/tray options which are P1. */
export function SettingsPage() {
  const [adding, setAdding] = useState(false);
  const t = useT();
  const statuses = useConnectionStatuses();
  const anyConnected = useAnyConnected();
  const settings = useSettings();
  const health = useStorageHealth();
  const updateSettings = useUpdateSettings();

  const hubs = useHubs();
  const reconnect = useReconnectHubs();
  const removeHub = useRemoveHub();
  const known = hubs.data ?? [];

  // The widget only has a Home Assistant client to feed if there is one.
  const hasHomeAssistant = known.some((hub) => hub.kind === 'homeassistant');

  /** Hubs run side by side, so each carries its own state rather than one badge. */
  const stateOf = (id: string): ConnectionState =>
    statuses.data?.find((status) => status.providerId === id)?.state ?? 'disconnected';

  return (
    <div className="space-y-6 px-4 py-4 pb-6">
      <h1 className="px-1 text-lg font-semibold tracking-tight">{t('nav.settings')}</h1>

      <section className="space-y-3">
        <h2 className="label-caps px-1">{t('settings.hubs')}</h2>
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
                      {entry.swVersion
                        ? ` · ${t('settings.firmware', { version: entry.swVersion })}`
                        : ''}
                      {` · ${t(STATE_LABELS[state])}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeHub.mutate(entry.id)}
                    aria-label={t('common.removeNamed', { name: entry.name })}
                    className="min-h-8 rounded-row px-2 text-sm text-ink-muted transition-colors hover:text-danger focus-visible:focus-ring"
                  >
                    {t('common.remove')}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('settings.noHub')}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => reconnect.mutate()}
            className="min-h-9 flex-1 rounded-row border border-line px-4 text-sm transition-colors hover:bg-line/40 focus-visible:focus-ring"
          >
            {t('settings.reconnectAll')}
          </button>
          <button
            type="button"
            onClick={() => setAdding((open) => !open)}
            aria-expanded={adding}
            className="min-h-9 flex-1 rounded-row border border-line px-4 text-sm transition-colors hover:bg-line/40 focus-visible:focus-ring"
          >
            {adding ? t('common.cancel') : t('settings.addHub')}
          </button>
        </div>

        {adding && (
          <div className="card-stack p-4">
            <AddHub onConnected={() => setAdding(false)} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">{t('settings.appearance')}</h2>
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
              {t(THEME_LABELS[theme])}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">{t('settings.quickActions')}</h2>
        <ActionEditor connected={anyConnected} />
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">{t('settings.startup')}</h2>
        <div className="card-stack flex items-center gap-3 p-4">
          <span className="min-w-0 flex-1 text-sm">
            {t('settings.launchAtLogin')}
            <span className="mt-0.5 block text-xs text-ink-muted">
              {t('settings.launchAtLoginHint')}
            </span>
          </span>
          <PowerSwitch
            checked={settings.data?.launchAtLogin ?? false}
            label={t('settings.launchAtLogin')}
            onCheckedChange={(launchAtLogin) => updateSettings.mutate({ launchAtLogin })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">{t('settings.about')}</h2>
        <UpdateCard />
      </section>

      {hasHomeAssistant && (
        <section className="space-y-3">
          <h2 className="label-caps px-1">{t('settings.widget')}</h2>
          <div className="card-stack flex items-center gap-3 p-4">
            <span className="min-w-0 flex-1 text-sm">
              {t('settings.widgetHa')}
              <span className="mt-0.5 block text-xs text-ink-muted">
                {t('settings.widgetHaHint')}
              </span>
            </span>
            <PowerSwitch
              checked={settings.data?.exportHomeAssistantToWidget ?? false}
              label={t('settings.widgetHa')}
              onCheckedChange={(exportHomeAssistantToWidget) =>
                updateSettings.mutate({ exportHomeAssistantToWidget })
              }
            />
          </div>
        </section>
      )}

      {health.data?.weak && (
        <section className="rounded-card border-l-4 border-amber-500 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400">
          <p className="font-medium">{t('settings.weakTitle')}</p>
          <p className="mt-1">
            {t('settings.weakBody', {
              backend: health.data.backend ? ` (backend: ${health.data.backend})` : '',
            })}
          </p>
        </section>
      )}
    </div>
  );
}
