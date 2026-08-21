import { ConnectionStatusBadge } from './components/ConnectionStatus';
import { EmptyState } from './components/EmptyState';
import { Toaster } from './components/Toaster';
import { useConnectionStatus, useHueEvents } from './hooks/useHue';
import { HomePage, HomeSkeleton } from './pages/HomePage';
import { LightPage } from './pages/LightPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { RoomPage } from './pages/RoomPage';
import { SettingsPage } from './pages/SettingsPage';
import { useUiStore } from './stores/uiStore';

/**
 * Shell and routing (PRD §6, §7).
 *
 * Routing is a switch over one state value rather than a router: there are four
 * screens and no URLs to speak of in a desktop window.
 */
export function App() {
  useHueEvents();

  const status = useConnectionStatus();
  const view = useUiStore((state) => state.view);
  const navigate = useUiStore((state) => state.navigate);
  const goHome = useUiStore((state) => state.goHome);

  // Nothing stored means we have never paired — start the onboarding flow.
  if (status.isSuccess && status.data.bridge === null) {
    return <OnboardingPage />;
  }

  const connected = status.data?.state === 'connected';
  const canGoBack = view.name === 'room' || view.name === 'light';

  return (
    <div className="relative flex h-full flex-col">
      <header className="drag-region flex shrink-0 items-center gap-3 px-4 pt-8 pb-3">
        {canGoBack ? (
          <button
            type="button"
            onClick={goHome}
            aria-label="Wstecz"
            className="-ml-1.5 flex min-h-8 items-center gap-0.5 rounded-full px-2 text-sm font-medium text-ink transition-colors hover:bg-line/50 focus-visible:focus-ring"
          >
            <span aria-hidden>‹</span> Wstecz
          </button>
        ) : (
          <span className="text-sm font-semibold tracking-tight">Hue Desktop</span>
        )}
        <span className="ml-auto">
          <ConnectionStatusBadge status={status.data} />
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!connected && view.name !== 'settings' ? (
          status.data?.state === 'disconnected' ? (
            <EmptyState
              title="Brak połączenia z Hue Bridge"
              description="Sprawdź, czy Bridge jest włączony i w tej samej sieci co ten komputer."
              action={{ label: 'Otwórz ustawienia', onClick: () => navigate({ name: 'settings' }) }}
            />
          ) : (
            <HomeSkeleton />
          )
        ) : view.name === 'home' ? (
          <HomePage connected={connected} />
        ) : view.name === 'room' ? (
          <RoomPage id={view.id} connected={connected} />
        ) : view.name === 'light' ? (
          <LightPage id={view.id} connected={connected} />
        ) : (
          <SettingsPage />
        )}
      </main>

      <nav className="flex shrink-0 border-t border-line">
        {(
          [
            { key: 'home', label: 'Dom', active: view.name !== 'settings', onClick: goHome },
            {
              key: 'settings',
              label: 'Ustawienia',
              active: view.name === 'settings',
              onClick: () => navigate({ name: 'settings' }),
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={tab.onClick}
            aria-current={tab.active ? 'page' : undefined}
            className={`relative min-h-11 flex-1 text-sm transition-colors focus-visible:focus-ring ${
              tab.active ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.active && (
              <span
                aria-hidden
                className="absolute inset-x-[38%] top-0 h-0.5 rounded-full bg-accent"
              />
            )}
          </button>
        ))}
      </nav>

      <Toaster />
    </div>
  );
}
