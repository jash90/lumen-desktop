import { AppError } from '../../shared/errors';
import type { ConnectionState, ConnectionStatus } from '../../shared/models';
import { backoffDelay, BACKOFF_STEPS_MS } from '../backoff';
import type {
  ChangeSet,
  LightingApi,
  ProviderAdapter,
  ProviderSession,
} from './LightingProvider';
import { toHubSummary, type ProviderCredential } from './ProviderCredential';

/**
 * One hub's connection and its retry policy (PRD §25, §51).
 *
 * Retry lives here and nowhere else. The provider reports that its push channel
 * closed and this decides what to do, so a flapping hub cannot start two
 * competing reconnect loops — and one hub retrying says nothing about any other,
 * which is why there is an instance per hub rather than one for the app.
 *
 * How the connection is actually made is the adapter's business, so the same
 * policy covers every brand.
 */

export interface ProviderConnection {
  readonly credential: ProviderCredential;
  connect(): Promise<void>;
  /** Tears down and dials again from scratch, resetting the backoff. */
  reconnect(): Promise<ConnectionStatus>;
  stop(): void;
  status(): ConnectionStatus;
  /** The live API, or null while this hub is not connected. */
  api(): LightingApi | null;
}

export interface ProviderConnectionOptions {
  credential: ProviderCredential;
  adapter: ProviderAdapter<ProviderCredential>;
  onStatus(status: ConnectionStatus): void;
  onChanges(changes: ChangeSet): void;
}

export function createProviderConnection(
  options: ProviderConnectionOptions,
): ProviderConnection {
  const { adapter, onStatus, onChanges } = options;

  let credential = options.credential;
  let state: ConnectionState = 'disconnected';
  let session: ProviderSession | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let retryAttempt = 0;
  let retryInMs: number | undefined;
  /** Guards against a stale reconnect finishing after this one was torn down. */
  let generation = 0;

  const buildStatus = (): ConnectionStatus => ({
    providerId: credential.id,
    kind: credential.kind,
    state,
    hub: toHubSummary(credential),
    retryInMs: state === 'reconnecting' ? retryInMs : undefined,
  });

  const setState = (next: ConnectionState): void => {
    state = next;
    onStatus(buildStatus());
  };

  const teardown = (): void => {
    session?.stop();
    session = null;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  function scheduleRetry(): void {
    const myGeneration = generation;
    retryInMs = backoffDelay(retryAttempt);
    retryAttempt = Math.min(retryAttempt + 1, BACKOFF_STEPS_MS.length - 1);
    setState('reconnecting');

    retryTimer = setTimeout(() => {
      if (myGeneration !== generation) return;
      void attemptConnect().catch(() => {
        /* attemptConnect already scheduled the next retry */
      });
    }, retryInMs);
  }

  async function attemptConnect(allowRelocate = true): Promise<void> {
    const myGeneration = generation;
    setState(state === 'reconnecting' ? 'reconnecting' : 'connecting');

    /** The session this attempt produced, once it exists. */
    let mine: ProviderSession | null = null;
    /** Enforces the at-most-once rule here rather than trusting each adapter. */
    let closeReported = false;

    try {
      const active = await adapter.connect(credential, {
        onChanges,
        onClosed: () => {
          if (closeReported) return;
          closeReported = true;

          // Only the session that is *currently* installed may trigger a retry.
          // A raw socket reports a drop twice — 'error' then 'close' — and by
          // the time the second one lands the retry may already have produced a
          // healthy replacement. Keying this on the session itself rather than
          // on a counter is what stops that closure from tearing down its own
          // successor. `stop()` and `teardown()` null the session out, so a
          // closure we caused ourselves lands here as "not mine" too.
          if (mine === null || session !== mine) return;

          teardown();
          scheduleRetry();
        },
      });

      if (myGeneration !== generation) {
        active.stop();
        return;
      }

      session = active;
      mine = active;

      // Reset the backoff only once the connection is fully up, push channel
      // included — which is what the adapter's promise stands for. Resetting
      // earlier meant a hub whose REST API answers but whose event stream keeps
      // failing would retry every second forever instead of backing off.
      retryAttempt = 0;
      retryInMs = undefined;
      setState('connected');
    } catch (error) {
      teardown();

      // A revoked key or a rejected token will never fix itself — retrying
      // would just spin forever.
      if (error instanceof AppError && error.code === 'Unauthorized') {
        setState('disconnected');
        throw error;
      }

      // The hub may simply have a new address after a DHCP lease renewal — but
      // only one such immediate retry per backoff cycle. An adapter whose
      // recover() keeps claiming a new address (a LAN discovery re-finding the
      // device it just failed on) would otherwise loop at full speed, with no
      // delay, no backoff and no status but a stuck "connecting".
      if (allowRelocate && (await relocate()) && myGeneration === generation) {
        return attemptConnect(false);
      }

      if (myGeneration === generation) scheduleRetry();
      throw error instanceof AppError ? error : new AppError('BridgeOffline', String(error));
    }
  }

  async function relocate(): Promise<boolean> {
    if (!adapter.recover) return false;
    const recovered = await adapter.recover(credential);
    if (!recovered) return false;
    credential = recovered;
    return true;
  }

  return {
    get credential() {
      return credential;
    },

    async connect() {
      await attemptConnect().catch(() => {
        /* retry is already scheduled; startup must not reject */
      });
    },

    async reconnect() {
      generation += 1;
      teardown();
      retryAttempt = 0;
      await attemptConnect().catch(() => {
        /* surfaced through status */
      });
      return buildStatus();
    },

    stop() {
      generation += 1;
      teardown();
      setState('disconnected');
    },

    status: buildStatus,
    api: () => session?.api ?? null,
  };
}
