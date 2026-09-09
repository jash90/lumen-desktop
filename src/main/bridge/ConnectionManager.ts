import { AppError } from '../../shared/errors';
import type {
  ChangeSet,
  LightingApi,
  ProviderAdapter,
  ProviderSession,
} from '../providers/LightingProvider';
import type { ConnectionState, ConnectionStatus } from '../../shared/models';
import { backoffDelay, BACKOFF_STEPS_MS } from '../backoff';
import type { BridgeCredential, BridgeRepository } from './BridgeRepository';

/**
 * Owns one live connection and its retry policy (PRD §25, §51).
 *
 * Retry lives here and nowhere else. The provider reports that its push channel
 * closed and this decides what to do, so a flapping hub cannot start two
 * competing reconnect loops.
 *
 * What it does *not* know is how the connection is made — that is the adapter's
 * job, so the same policy covers any brand.
 */

export interface ConnectionManager {
  /** Connects using stored credentials, if any. Safe to call when unpaired. */
  start(): Promise<void>;
  connect(credential: BridgeCredential): Promise<void>;
  reconnectNow(): Promise<ConnectionStatus>;
  disconnect(): Promise<void>;
  /** Forgets the bridge entirely (PRD §29 "Forget Bridge"). */
  forget(): Promise<void>;
  status(): ConnectionStatus;
  /** Throws BridgeOffline unless a live connection exists. */
  requireApi(): LightingApi;
}

export interface ConnectionManagerOptions {
  repository: BridgeRepository;
  adapter: ProviderAdapter<BridgeCredential>;
  onStatus(status: ConnectionStatus): void;
  onChanges(changes: ChangeSet): void;
}

export function createConnectionManager(options: ConnectionManagerOptions): ConnectionManager {
  const { repository, adapter, onStatus, onChanges } = options;

  let state: ConnectionState = 'disconnected';
  let credential: BridgeCredential | null = null;
  let session: ProviderSession | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let retryAttempt = 0;
  let retryInMs: number | undefined;
  /** Guards against a stale reconnect finishing after the user disconnected. */
  let generation = 0;

  const buildStatus = (): ConnectionStatus => ({
    state,
    bridge: credential
      ? {
          id: credential.bridgeId,
          name: credential.name,
          ip: credential.bridgeIp,
          modelId: credential.modelId,
          swVersion: credential.swVersion,
        }
      : null,
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

  async function attemptConnect(): Promise<void> {
    if (!credential) throw new AppError('BridgeNotFound', 'no stored credentials');
    const myGeneration = generation;
    setState(state === 'reconnecting' ? 'reconnecting' : 'connecting');

    try {
      const active = await adapter.connect(credential, {
        onChanges,
        onClosed: () => {
          // Ignore closures caused by our own teardown or by a newer connection.
          if (myGeneration !== generation || state === 'disconnected') return;
          teardown();
          scheduleRetry();
        },
      });

      if (myGeneration !== generation) {
        active.stop();
        return;
      }

      session = active;

      // Reset the backoff only once the connection is fully up, push channel
      // included — which is what the adapter's promise stands for. Resetting
      // earlier meant a bridge whose REST API answers but whose event stream
      // keeps failing would retry every second forever instead of backing off.
      retryAttempt = 0;
      retryInMs = undefined;
      setState('connected');
    } catch (error) {
      teardown();

      // A revoked key will never fix itself — retrying would just spin forever.
      if (error instanceof AppError && error.code === 'Unauthorized') {
        setState('disconnected');
        throw error;
      }

      // The hub may simply have a new address after a DHCP lease renewal.
      const relocated = await relocate();
      if (relocated && myGeneration === generation) {
        return attemptConnect();
      }

      if (myGeneration === generation) scheduleRetry();
      throw error instanceof AppError ? error : new AppError('BridgeOffline', String(error));
    }
  }

  async function relocate(): Promise<boolean> {
    if (!credential || !adapter.recover) return false;
    const recovered = await adapter.recover(credential);
    if (!recovered) return false;
    credential = recovered;
    return true;
  }

  return {
    async start() {
      try {
        credential = repository.getActive();
      } catch (error) {
        // Startup continues even if credentials cannot be read; the user can
        // always pair again.
        console.error('[connection] could not read stored credentials:', error);
        credential = null;
      }
      if (!credential) {
        setState('disconnected');
        return;
      }
      await attemptConnect().catch(() => {
        /* retry is already scheduled; startup must not reject */
      });
    },

    async connect(next) {
      generation += 1;
      teardown();
      credential = next;
      retryAttempt = 0;
      await attemptConnect();
    },

    async reconnectNow() {
      generation += 1;
      teardown();
      retryAttempt = 0;
      credential = repository.getActive();
      if (!credential) {
        setState('disconnected');
        return buildStatus();
      }
      await attemptConnect().catch(() => {
        /* surfaced through status */
      });
      return buildStatus();
    },

    async disconnect() {
      generation += 1;
      teardown();
      setState('disconnected');
    },

    async forget() {
      generation += 1;
      teardown();
      if (credential) repository.remove(credential.bridgeId);
      credential = null;
      setState('disconnected');
    },

    status: buildStatus,

    requireApi() {
      if (!session) throw new AppError('BridgeOffline', 'not connected to a bridge');
      return session.api;
    },
  };
}
