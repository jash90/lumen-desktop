import { describe, expect, it, vi } from 'vitest';

import { createProviderRegistry } from '../src/main/providers/ProviderRegistry';
import { createProviderRepository } from '../src/main/providers/ProviderRepository';
import type { HueCredential } from '../src/main/providers/ProviderCredential';
import type {
  LightingApi,
  ProviderAdapter,
  ProviderSession,
} from '../src/main/providers/LightingProvider';
import type { Light, Room } from '../src/shared/models';
import type { SecureStorage } from '../src/main/storage/SecureStorage';

/**
 * The point of the registry: two hubs on one screen. What matters is that one
 * failing hub does not take the other down with it, and that a command lands on
 * whichever hub actually owns the light.
 */

function createMemoryStorage(): SecureStorage {
  let value: unknown = null;
  return {
    read: <T>() => value as T | null,
    write: (data: unknown) => {
      value = data;
    },
    clear: () => {
      value = null;
    },
    health: () => ({ encryptionAvailable: true, backend: null, weak: false }),
  } as SecureStorage;
}

const credential = (id: string): HueCredential => ({
  kind: 'hue',
  id,
  name: id,
  address: '192.0.2.1',
  applicationKey: `key-${id}`,
});

const light = (id: string, providerId: string): Light => ({
  id,
  providerId,
  name: id,
  roomId: null,
  isOn: true,
  brightness: 70,
  capabilities: { dimming: true, colorTemperature: false, color: false },
});

const room = (id: string, providerId: string): Room => ({
  id,
  providerId,
  name: id,
  lightIds: [],
  isOn: true,
  brightness: 70,
  supportsGroupControl: true,
});

/** A hub that answers, remembering which calls it received. */
function fakeApi(providerId: string) {
  return {
    setLightPower: vi.fn(async () => undefined),
    setRoomPower: vi.fn(async () => undefined),
    refresh: async () => undefined,
    getLights: () => [light(`${providerId}-light`, providerId)],
    getRooms: () => [room(`${providerId}-room`, providerId)],
    getScenes: () => [],
    getAutomations: () => [],
    getLight: (id: string) => light(id, providerId),
    getRoom: (id: string) => room(id, providerId),
    setLightBrightness: async () => undefined,
    setLightColor: async () => undefined,
    setLightTemperature: async () => undefined,
    setRoomBrightness: async () => undefined,
    activateScene: async () => undefined,
    setAutomationEnabled: async () => undefined,
    applyUpdates: () => ({ lights: [], rooms: [] }),
  } satisfies LightingApi & { setLightPower: unknown; setRoomPower: unknown };
}

/** `failing` names the hubs whose connect() rejects, as an unreachable one would. */
function fakeAdapter(failing: readonly string[] = []) {
  const apis = new Map<string, ReturnType<typeof fakeApi>>();

  const adapter: ProviderAdapter<HueCredential> = {
    kind: 'hue',
    async connect(cred): Promise<ProviderSession> {
      if (failing.includes(cred.id)) throw new Error('unreachable');
      const api = fakeApi(cred.id);
      apis.set(cred.id, api);
      return { api, stop: () => undefined };
    },
  };

  return { adapter, apis };
}

function createRegistry(ids: string[], failing: string[] = []) {
  const repository = createProviderRepository(createMemoryStorage());
  for (const id of ids) repository.save(credential(id));

  const { adapter, apis } = fakeAdapter(failing);
  const registry = createProviderRegistry({
    repository,
    adapters: { hue: adapter },
    onStatuses: () => undefined,
    onChanges: () => undefined,
  });

  return { registry, apis, repository };
}

describe('createProviderRegistry', () => {
  it('shows the lights of every connected hub on one list', async () => {
    const { registry } = createRegistry(['bridge-1', 'bridge-2']);
    await registry.start();

    expect(registry.getLights().map((entry) => entry.id).sort()).toEqual([
      'bridge-1-light',
      'bridge-2-light',
    ]);
  });

  it('keeps serving the hubs that are up when one is unreachable', async () => {
    const { registry } = createRegistry(['bridge-1', 'bridge-2'], ['bridge-2']);
    await registry.start();

    expect(registry.getLights().map((entry) => entry.id)).toEqual(['bridge-1-light']);
    expect(registry.statuses()).toHaveLength(2);
    expect(registry.statuses().find((s) => s.providerId === 'bridge-1')?.state).toBe('connected');
    expect(registry.statuses().find((s) => s.providerId === 'bridge-2')?.state).not.toBe(
      'connected',
    );
  });

  it('routes a command to the hub that owns the light, not the first one', async () => {
    const { registry, apis } = createRegistry(['bridge-1', 'bridge-2']);
    await registry.start();

    await registry.setLightPower('bridge-2-light', false);

    expect(apis.get('bridge-2')?.setLightPower).toHaveBeenCalledWith('bridge-2-light', false);
    expect(apis.get('bridge-1')?.setLightPower).not.toHaveBeenCalled();
  });

  it('refuses a command for a light whose hub is not connected', async () => {
    const { registry } = createRegistry(['bridge-1']);
    await registry.start();

    await expect(registry.setLightPower('bridge-2-light', false)).rejects.toMatchObject({
      code: 'ResourceUnavailable',
    });
  });

  /**
   * A hub kind this build has no adapter for used to abort start() for every
   * hub — and since save() puts the newest first, the unsupported one was
   * usually the one at index 0. Downgrading a build was enough to trigger it.
   */
  it('skips a hub it cannot drive instead of stopping every other one', async () => {
    const repository = createProviderRepository(createMemoryStorage());
    repository.save({
      kind: 'homeassistant',
      id: 'ha-1',
      name: 'Home Assistant',
      address: 'http://ha.local:8123',
      token: 'token',
    });
    repository.save(credential('bridge-1'));

    const { adapter } = fakeAdapter();
    const registry = createProviderRegistry({
      repository,
      // Deliberately no 'homeassistant' adapter.
      adapters: { hue: adapter },
      onStatuses: () => undefined,
      onChanges: () => undefined,
    });

    await registry.start();

    expect(registry.getLights().map((entry) => entry.id)).toEqual(['bridge-1-light']);
    expect(registry.statuses().map((status) => status.providerId)).toEqual(['bridge-1']);
  });

  it('refuses to store a hub it cannot reach', async () => {
    const { registry, repository } = createRegistry([], []);
    const { adapter } = fakeAdapter(['bridge-9']);
    const failing = createProviderRegistry({
      repository,
      adapters: { hue: adapter },
      onStatuses: () => undefined,
      onChanges: () => undefined,
    });

    await expect(failing.add(credential('bridge-9'))).rejects.toMatchObject({
      code: 'BridgeOffline',
    });
    // Nothing on disk means the next start() has nothing to trip over.
    expect(repository.get('bridge-9')).toBeNull();
    expect(registry.statuses()).toHaveLength(0);
  });

  it('drops a removed hub from both the store and the merged lists', async () => {
    const { registry, repository } = createRegistry(['bridge-1', 'bridge-2']);
    await registry.start();

    await registry.remove('bridge-1');

    expect(registry.getLights().map((entry) => entry.id)).toEqual(['bridge-2-light']);
    expect(repository.get('bridge-1')).toBeNull();
  });
});
