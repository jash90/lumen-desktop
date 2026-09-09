import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PairingState } from '../../shared/ipc';
import type { ProviderKind } from '../../shared/models';
import { messageOf, queryKeys, unwrap } from '../lib/api';
import { Skeleton } from './Skeleton';

/**
 * Connecting a hub, whichever kind it is.
 *
 * Shared by first-run onboarding and the settings screen, because "connect your
 * first hub" and "connect another one" are the same job — and with hubs running
 * side by side rather than one at a time, the second case is now the common one.
 */

const KIND_LABELS: Record<ProviderKind, string> = {
  hue: 'Hue Bridge',
  homeassistant: 'Home Assistant',
};

export function AddHub({ onConnected }: { onConnected?: () => void }) {
  const [kind, setKind] = useState<ProviderKind>('hue');

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="Hub type">
        {(Object.keys(KIND_LABELS) as ProviderKind[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            aria-pressed={kind === option}
            className={`min-h-9 flex-1 rounded-row border px-3 text-sm transition-colors focus-visible:focus-ring ${
              kind === option
                ? 'border-accent bg-accent/10 font-medium text-ink'
                : 'border-line text-ink-muted hover:text-ink'
            }`}
          >
            {KIND_LABELS[option]}
          </button>
        ))}
      </div>

      <ConnectFlow kind={kind} onConnected={onConnected} />
    </div>
  );
}

/**
 * Exhaustive on purpose. A ternary here would silently render the Home Assistant
 * token form under any new tab, so the `never` is what makes adding a hub kind a
 * compile error rather than a confusing screen.
 */
function ConnectFlow({ kind, onConnected }: { kind: ProviderKind; onConnected?: () => void }) {
  switch (kind) {
    case 'hue':
      return <HueConnect onConnected={onConnected} />;
    case 'homeassistant':
      return <HomeAssistantConnect onConnected={onConnected} />;
    default: {
      const unreachable: never = kind;
      throw new Error(`no connect flow for ${String(unreachable)}`);
    }
  }
}

/**
 * The link-button ceremony (PRD §22, §40). The whole flow is driven by the
 * pairing state pushed from the main process, which is why the "press the
 * button" step needs no timer of its own.
 */
function HueConnect({ onConnected }: { onConnected?: () => void }) {
  const [pairing, setPairing] = useState<PairingState>({ status: 'idle' });
  const [manualIp, setManualIp] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => window.lumen.onPairingState(setPairing), []);

  const discovery = useQuery({
    queryKey: ['discovery'],
    queryFn: () => unwrap(window.lumen.discoverBridges()),
    retry: false,
  });

  const pair = useMutation({
    mutationFn: (ip: string) => unwrap(window.lumen.pairBridge(ip)),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onConnected?.();
    },
  });

  const busy = pairing.status === 'pairing' || pairing.status === 'waitingForButton';

  if (busy) {
    return (
      <div className="card-stack enter border-accent/40 p-5 text-center">
        <div className="relative mx-auto mb-4 h-12 w-12">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/30" />
          <span className="absolute inset-0 rounded-full bg-accent/20" />
        </div>
        <p className="font-medium">Press the button on the Hue Bridge</p>
        <p className="mt-1 text-sm text-ink-muted">
          {pairing.status === 'waitingForButton'
            ? `Waiting… ${pairing.secondsLeft} s left`
            : 'Connecting…'}
        </p>
        <button
          type="button"
          onClick={() => void window.lumen.cancelPairing()}
          className="mt-4 rounded-row px-2 py-1 text-sm text-ink-muted underline decoration-line underline-offset-4 focus-visible:focus-ring"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="label-caps">Bridges found</h2>
          <button
            type="button"
            onClick={() => void discovery.refetch()}
            disabled={discovery.isFetching}
            className="rounded-row px-1 text-xs text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink-muted focus-visible:focus-ring disabled:opacity-50"
          >
            {discovery.isFetching ? 'Searching…' : 'Search again'}
          </button>
        </div>

        {discovery.isFetching && !discovery.data && (
          <div
            className="card-stack divide-y divide-line"
            aria-busy="true"
            aria-label="Searching for a Hue Bridge"
          >
            {[0, 1].map((row) => (
              <div key={row} className="space-y-2 px-4 py-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
        )}

        {!discovery.isFetching && (discovery.isError || discovery.data?.length === 0) && (
          <p className="text-sm text-ink-muted">
            No Bridge was found automatically. Enter an IP address below — mDNS does not cross
            subnets or work over a VPN.
          </p>
        )}

        <ul className="card-stack divide-y divide-line">
          {discovery.data?.map((bridge) => (
            <li key={bridge.id}>
              <button
                type="button"
                onClick={() => pair.mutate(bridge.ip)}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-line/40 focus-visible:focus-ring"
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
        <h2 className="label-caps">Manual IP address</h2>
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
            aria-label="Hue Bridge IP address"
            className="min-h-9 flex-1 rounded-row border border-line bg-surface-raised px-3 text-sm outline-none focus:border-accent focus-visible:focus-ring"
          />
          <button
            type="submit"
            className="min-h-9 rounded-row bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-105 focus-visible:focus-ring disabled:opacity-50"
            disabled={!manualIp.trim()}
          >
            Connect
          </button>
        </form>
      </section>

      {(pairing.status === 'failed' || pair.isError) && (
        <p className="rounded-card border-l-4 border-danger bg-danger/10 px-4 py-3 text-sm text-danger">
          {pairing.status === 'failed' ? pairing.error.message : messageOf(pair.error)}
        </p>
      )}
    </div>
  );
}

/**
 * No ceremony here — a URL and a long-lived token. Everything Home Assistant
 * already controls arrives through it, which is how brands with no API of their
 * own end up in this app.
 */
function HomeAssistantConnect({ onConnected }: { onConnected?: () => void }) {
  const [baseUrl, setBaseUrl] = useState('http://homeassistant.local:8123');
  const [token, setToken] = useState('');
  const queryClient = useQueryClient();

  const connect = useMutation({
    mutationFn: () => unwrap(window.lumen.connectHomeAssistant({ baseUrl, token })),
    onSuccess: () => {
      setToken('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs });
      void queryClient.invalidateQueries();
      onConnected?.();
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (baseUrl.trim() && token.trim()) connect.mutate();
      }}
    >
      <label className="block space-y-1">
        <span className="label-caps">Address</span>
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://homeassistant.local:8123"
          className="min-h-9 w-full rounded-row border border-line bg-surface-raised px-3 text-sm outline-none focus:border-accent focus-visible:focus-ring"
        />
      </label>

      <label className="block space-y-1">
        <span className="label-caps">Long-lived access token</span>
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="min-h-9 w-full rounded-row border border-line bg-surface-raised px-3 font-mono text-sm outline-none focus:border-accent focus-visible:focus-ring"
        />
        <span className="block text-xs text-ink-muted">
          In Home Assistant: your profile → Security → Long-lived access tokens.
        </span>
      </label>

      <button
        type="submit"
        disabled={!baseUrl.trim() || !token.trim() || connect.isPending}
        className="min-h-9 w-full rounded-row bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-105 focus-visible:focus-ring disabled:opacity-50"
      >
        {connect.isPending ? 'Connecting…' : 'Connect'}
      </button>

      {connect.isError && (
        <p className="rounded-card border-l-4 border-danger bg-danger/10 px-4 py-3 text-sm text-danger">
          {messageOf(connect.error)}
        </p>
      )}
    </form>
  );
}
