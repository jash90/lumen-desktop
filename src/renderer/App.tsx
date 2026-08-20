import { ConnectionStatusBadge } from './components/ConnectionStatus';
import { Toaster } from './components/Toaster';
import { useConnectionStatus, useHueEvents } from './hooks/useHue';
import { HomePage } from './pages/HomePage';
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
      <header className="drag-region flex shrink-0 items-center gap-3 border-b border-line px-4 pt-7 pb-3">
        {canGoBack ? (
          <button
            type="button"
            onClick={goHome}
            aria-label="Wstecz"
            className="text-sm text-accent"
          >
            ‹ Wstecz
          </button>
        ) : (
          <span className="text-sm font-semibold">Hue Desktop</span>
        )}
        <span className="ml-auto">
          <ConnectionStatusBadge status={status.data} />
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!connected && view.name !== 'settings' ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-ink-muted">
              {status.data?.state === 'disconnected'
                ? 'Nie udało się połączyć z Hue Bridge.'
                : 'Łączenie z Hue Bridge…'}
            </p>
          </div>
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
        <button
          type="button"
          onClick={goHome}
          className={`flex-1 py-3 text-sm ${view.name === 'settings' ? 'text-ink-muted' : 'text-accent'}`}
        >
          Dom
        </button>
        <button
          type="button"
          onClick={() => navigate({ name: 'settings' })}
          className={`flex-1 py-3 text-sm ${view.name === 'settings' ? 'text-accent' : 'text-ink-muted'}`}
        >
          Ustawienia
        </button>
      </nav>

      <Toaster />
    </div>
  );
}
