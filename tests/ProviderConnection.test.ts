import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/shared/errors';
import { createProviderConnection } from '../src/main/providers/ProviderConnection';
import type {
  LightingApi,
  ProviderAdapter,
  ProviderHooks,
  ProviderSession,
} from '../src/main/providers/LightingProvider';
import type { HueCredential } from '../src/main/providers/ProviderCredential';
import type { ConnectionStatus } from '../src/shared/models';

/**
 * The retry policy, which every provider inherits and none of them can override.
 *
 * It had no coverage at all, which is how a stale session was able to tear down
 * its own replacement: the guard that was supposed to stop that is keyed on a
 * counter the retry path never advances.
 */

const credential: HueCredential = {
  kind: 'hue',
  id: 'bridge-1',
  name: 'Home',
  address: '192.0.2.1',
  applicationKey: 'key',
};

/** Enough of a LightingApi to be handed back as a session. */
const api = {} as LightingApi;

interface Harness {
  adapter: ProviderAdapter<HueCredential>;
  /** Every session handed out, newest last, each with its own hooks. */
  sessions: { hooks: ProviderHooks; stop: ReturnType<typeof vi.fn> }[];
  statuses: ConnectionStatus[];
}

function createHarness(options: {
  /** Connect attempts that reject, by 1-based attempt number. */
  failAttempts?: readonly number[];
  failWith?: AppError;
  recover?: ProviderAdapter<HueCredential>['recover'];
}): Harness {
  const sessions: Harness['sessions'] = [];
  const statuses: ConnectionStatus[] = [];
  let attempt = 0;

  const adapter: ProviderAdapter<HueCredential> = {
    kind: 'hue',
    async connect(_credential, hooks): Promise<ProviderSession> {
      attempt += 1;
      if (options.failAttempts?.includes(attempt)) {
        throw options.failWith ?? new AppError('BridgeOffline', 'unreachable');
      }
      const stop = vi.fn();
      sessions.push({ hooks, stop });
      return { api, stop };
    },
    recover: options.recover,
  };

  return { adapter, sessions, statuses };
}

const connectionOf = (harness: Harness) =>
  createProviderConnection({
    credential,
    adapter: harness.adapter as ProviderAdapter<never>,
    onStatus: (status) => harness.statuses.push(status),
    onChanges: () => undefined,
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ProviderConnection', () => {
  it('comes up and reports itself connected', async () => {
    const harness = createHarness({});
    const connection = connectionOf(harness);

    await connection.connect();

    expect(connection.status().state).toBe('connected');
    expect(connection.api()).toBe(api);
  });

  /**
   * A raw TCP socket emits 'error' and then 'close' — two onClosed calls for one
   * drop. The second arrives after the retry has already produced a healthy
   * session, and must not be allowed to take that one down with it.
   */
  it('does not let a dead session tear down the one that replaced it', async () => {
    const harness = createHarness({});
    const connection = connectionOf(harness);
    await connection.connect();

    const first = harness.sessions[0]!;

    // The socket drops: teardown + a scheduled retry.
    first.hooks.onClosed();
    expect(connection.status().state).toBe('reconnecting');

    // The retry succeeds, so there is a live second session.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connection.status().state).toBe('connected');
    expect(harness.sessions).toHaveLength(2);

    // Now the *first* socket's second event finally lands.
    first.hooks.onClosed();

    expect(connection.status().state).toBe('connected');
    expect(connection.api()).toBe(api);
    expect(harness.sessions[1]!.stop).not.toHaveBeenCalled();
  });

  /**
   * `recover()` is allowed to say "I moved it", and the connection retries
   * immediately on the strength of that. An adapter that keeps saying so — a LAN
   * discovery that re-finds the device it just failed on — must not spin the
   * process at full speed with no backoff and no status.
   */
  it('does not spin when recover keeps claiming a new address', async () => {
    const recover = vi.fn(async (current: HueCredential) => ({
      ...current,
      address: `192.0.2.${Math.floor(Math.random() * 200) + 2}`,
    }));
    const harness = createHarness({
      failAttempts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      recover,
    });
    const connection = connectionOf(harness);

    await connection.connect();

    // One relocate per failed attempt at most; anything more is the runaway loop.
    expect(recover.mock.calls.length).toBeLessThanOrEqual(2);
    expect(connection.status().state).toBe('reconnecting');
  });

  it('retries with a backoff after a failure, then settles once the hub answers', async () => {
    const harness = createHarness({ failAttempts: [1] });
    const connection = connectionOf(harness);

    await connection.connect();
    expect(connection.status().state).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(connection.status().state).toBe('connected');
  });

  /** A revoked key never fixes itself; retrying it forever helps nobody. */
  it('stops retrying when the hub rejects the credential', async () => {
    const harness = createHarness({
      failAttempts: [1],
      failWith: new AppError('Unauthorized', 'revoked'),
    });
    const connection = connectionOf(harness);

    await connection.connect();
    expect(connection.status().state).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.sessions).toHaveLength(0);
    expect(connection.status().state).toBe('disconnected');
  });

  it('abandons a scheduled retry when it is stopped', async () => {
    const harness = createHarness({ failAttempts: [1] });
    const connection = connectionOf(harness);
    await connection.connect();

    connection.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(harness.sessions).toHaveLength(0);
    expect(connection.status().state).toBe('disconnected');
  });

  it('closes the live session when it is stopped', async () => {
    const harness = createHarness({});
    const connection = connectionOf(harness);
    await connection.connect();

    connection.stop();

    expect(harness.sessions[0]!.stop).toHaveBeenCalledOnce();
    expect(connection.api()).toBeNull();
  });

  /** Ignoring a closure we caused ourselves — the other half of the guard. */
  it('ignores a closure that arrives after it was stopped', async () => {
    const harness = createHarness({});
    const connection = connectionOf(harness);
    await connection.connect();

    connection.stop();
    harness.sessions[0]!.hooks.onClosed();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(connection.status().state).toBe('disconnected');
    expect(harness.sessions).toHaveLength(1);
  });
});
