import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import type { PairingState } from '../../shared/ipc';
import { messageOf, unwrap } from '../lib/hue';
import { useStorageHealth } from '../hooks/useHue';

/**
 * First-run flow (PRD §5, §22, §40).
 *
 * The whole screen is driven by the pairing state machine pushed from the main
 * process, which is why the "press the button" step needs no timer of its own.
 */
export function OnboardingPage() {
  const [pairing, setPairing] = useState<PairingState>({ status: 'idle' });
  const [manualIp, setManualIp] = useState('');

  useEffect(() => window.hue.onPairingState(setPairing), []);

  const discovery = useQuery({
    queryKey: ['discovery'],
    queryFn: () => unwrap(window.hue.discoverBridges()),
    retry: false,
  });

  const pair = useMutation({
    mutationFn: (ip: string) => unwrap(window.hue.pairBridge(ip)),
  });

  const health = useStorageHealth();

  const busy = pairing.status === 'pairing' || pairing.status === 'waitingForButton';

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-12 pb-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Hue Desktop</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Połącz aplikację z Hue Bridge w Twojej sieci domowej.
        </p>
      </header>

      {busy ? (
        <div className="rounded-xl border border-accent/40 bg-surface-raised p-5 text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-pulse rounded-full bg-accent/20" />
          <p className="font-medium">Naciśnij przycisk na Hue Bridge</p>
          <p className="mt-1 text-sm text-ink-muted">
            {pairing.status === 'waitingForButton'
              ? `Czekam… pozostało ${pairing.secondsLeft} s`
              : 'Łączenie…'}
          </p>
          <button
            type="button"
            onClick={() => void window.hue.cancelPairing()}
            className="mt-4 text-sm text-ink-muted underline"
          >
            Anuluj
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Znalezione Bridge
              </h2>
              <button
                type="button"
                onClick={() => void discovery.refetch()}
                disabled={discovery.isFetching}
                className="text-xs text-accent disabled:opacity-50"
              >
                {discovery.isFetching ? 'Szukam…' : 'Szukaj ponownie'}
              </button>
            </div>

            {discovery.isFetching && !discovery.data && (
              <p className="text-sm text-ink-muted">Szukam Hue Bridge…</p>
            )}

            {!discovery.isFetching && (discovery.isError || discovery.data?.length === 0) && (
              <p className="text-sm text-ink-muted">
                Nie znaleziono Bridge automatycznie. Wpisz adres IP poniżej — mDNS nie działa
                między podsieciami ani przez VPN.
              </p>
            )}

            <ul className="space-y-2">
              {discovery.data?.map((bridge) => (
                <li key={bridge.id}>
                  <button
                    type="button"
                    onClick={() => pair.mutate(bridge.ip)}
                    className="w-full rounded-xl bg-surface-raised px-4 py-3 text-left transition-colors hover:bg-line/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    <span className="block text-sm font-medium">{bridge.name ?? 'Hue Bridge'}</span>
                    <span className="text-xs text-ink-muted">
                      {bridge.ip} · {bridge.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Adres IP ręcznie
            </h2>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (manualIp.trim()) pair.mutate(manualIp.trim());
              }}
            >
              <input
                value={manualIp}
                onChange={(event) => setManualIp(event.target.value)}
                placeholder="192.168.1.42"
                inputMode="numeric"
                aria-label="Adres IP Hue Bridge"
                className="flex-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={!manualIp.trim()}
              >
                Połącz
              </button>
            </form>
          </section>

          {health.data?.weak && (
            <p className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
              System nie udostępnia bezpiecznego magazynu haseł
              {health.data.backend ? ` (backend: ${health.data.backend})` : ''}. Po sparowaniu klucz
              aplikacji nie zostanie zapisany i trzeba będzie parować ponownie po restarcie.
            </p>
          )}

          {(pairing.status === 'failed' || pair.isError) && (
            <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {pairing.status === 'failed' ? pairing.error.message : messageOf(pair.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
