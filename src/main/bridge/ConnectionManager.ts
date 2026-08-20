import { HueError } from '../../shared/errors';
import type { ChangeSet, HueApi } from '../hue/HueApi';
import { createHueApi } from '../hue/HueApi';
import { createHueClient } from '../hue/HueClient';
import { startEventStream, type EventStreamHandle } from '../hue/HueEventStream';
import { createHueTransport, type HueTransport } from '../hue/HueTransport';
import type { ConnectionState, ConnectionStatus } from '../../shared/models';
import { backoffDelay, BACKOFF_STEPS_MS } from '../backoff';
import type { BridgeDiscoveryService } from './BridgeDiscoveryService';
import type { BridgeCredential, BridgeRepository } from './BridgeRepository';

/**
 * Owns the live connection: transport, client, event stream and the retry policy
 * (PRD §25, §51).
 *
 * Retry lives here and nowhere else. The event stream reports that it closed and
 * this decides what to do, so a flapping bridge cannot start two competing
 * reconnect loops.
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
  requireApi(): HueApi;
}

export interface ConnectionManagerOptions {
  repository: BridgeRepository;
  discovery: BridgeDiscoveryService;
  onStatus(status: ConnectionStatus): void;
  onChanges(changes: ChangeSet): void;
}

export function createConnectionManager(options: ConnectionManagerOptions): ConnectionManager {
  const { repository, discovery, onStatus, onChanges } = options;

  let state: ConnectionState = 'disconnected';
  let credential: BridgeCredential | null = null;
  let transport: HueTransport | null = null;
  let api: HueApi | null = null;
  let stream: EventStreamHandle | null = null;
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
    stream?.stop();
    stream = null;
    transport?.destroy();
    transport = null;
    api = null;
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

  async function openStream(active: BridgeCredential, activeTransport: HueTransport) {
    const myGeneration = generation;
    stream = await startEventStream({
      transport: activeTransport,
      applicationKey: active.applicationKey,
      onUpdates: (updates) => {
        if (!api) return;
        const changes = api.applyUpdates(updates);
        if (changes.lights.length > 0 || changes.rooms.length > 0) onChanges(changes);
      },
      onClosed: () => {
        // Ignore closures caused by our own teardown or by a newer connection.
        if (myGeneration !== generation || state === 'disconnected') return;
        teardown();
        scheduleRetry();
      },
    });
  }

  async function attemptConnect(): Promise<void> {
    if (!credential) throw new HueError('BridgeNotFound', 'no stored credentials');
    const myGeneration = generation;
    setState(state === 'reconnecting' ? 'reconnecting' : 'connecting');

    try {
      const activeTransport = createHueTransport(credential.bridgeIp, credential.bridgeId);
      const client = createHueClient(activeTransport, credential.applicationKey);
      const activeApi = createHueApi(client);
      await activeApi.refresh();

      if (myGeneration !== generation) {
        activeTransport.destroy();
        return;
      }

      transport = activeTransport;
      api = activeApi;
      await openStream(credential, activeTransport);

      // Reset the backoff only once the connection is fully up, event stream
      // included. Resetting before openStream meant a bridge whose REST API
      // answers but whose event stream keeps failing would retry every second
      // forever instead of backing off.
      retryAttempt = 0;
      retryInMs = undefined;
      setState('connected');
    } catch (error) {
      teardown();

      // A revoked key will never fix itself — retrying would just spin forever.
      if (error instanceof HueError && error.code === 'Unauthorized') {
        setState('disconnected');
        throw error;
      }

      // The bridge may simply have a new address after a DHCP lease renewal.
      const relocated = await relocate();
      if (relocated && myGeneration === generation) {
        return attemptConnect();
      }

      if (myGeneration === generation) scheduleRetry();
      throw error instanceof HueError ? error : new HueError('BridgeOffline', String(error));
    }
  }

  /** Re-runs discovery to find the same bridge id at a different address (PRD §51). */
  async function relocate(): Promise<boolean> {
    if (!credential) return false;
    const ip = await discovery.findKnownBridge(credential.bridgeId);
    if (!ip || ip === credential.bridgeIp) return false;
    repository.updateIp(credential.bridgeId, ip);
    credential = { ...credential, bridgeIp: ip };
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
      if (!api) throw new HueError('BridgeOffline', 'not connected to a bridge');
      return api;
    },
  };
}
