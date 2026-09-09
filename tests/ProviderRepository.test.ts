import { describe, expect, it } from 'vitest';

import {
  createProviderRepository,
  type ProviderRepository,
} from '../src/main/providers/ProviderRepository';
import { toHubSummary, type HueCredential } from '../src/main/providers/ProviderCredential';
import type { SecureStorage } from '../src/main/storage/SecureStorage';

/** In-memory stand-in — the encryption itself is covered by SecureStorage.test.ts. */
function createMemoryStorage(seed: unknown = null): SecureStorage {
  let value: unknown = seed;
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

const credential = (id: string, name: string): HueCredential => ({
  kind: 'hue',
  id,
  address: `192.0.2.${id.slice(-1)}`,
  name,
  applicationKey: `key-${id}`,
});

const withTwo = (): ProviderRepository => {
  const repository = createProviderRepository(createMemoryStorage());
  repository.save(credential('bridge-1', 'Home'));
  repository.save(credential('bridge-2', 'Office'));
  return repository;
};

describe('ProviderRepository', () => {
  it('keeps every stored hub — they all connect, side by side', () => {
    expect(withTwo().list().map((entry) => entry.id)).toEqual(['bridge-2', 'bridge-1']);
  });

  it('does not store the same hub twice when it is paired again', () => {
    const repository = withTwo();
    repository.save({ ...credential('bridge-1', 'Home'), address: '192.0.2.99' });

    expect(repository.list()).toHaveLength(2);
    expect(repository.get('bridge-1')?.address).toBe('192.0.2.99');
  });

  it('keeps the secret when DHCP moves a hub to a new address', () => {
    const repository = withTwo();
    repository.updateAddress('bridge-1', '192.0.2.77');

    const moved = repository.get('bridge-1');
    expect(moved).toMatchObject({ address: '192.0.2.77', applicationKey: 'key-bridge-1' });
  });

  it('leaves the other hubs alone when one is removed', () => {
    const repository = withTwo();
    repository.remove('bridge-1');

    expect(repository.list().map((entry) => entry.id)).toEqual(['bridge-2']);
    expect(repository.get('bridge-1')).toBeNull();
  });

  /**
   * Everything stored before multi-provider support was a Hue bridge under the
   * old field names. Failing to read it would silently unpair every user.
   */
  it('reads the pre-multi-provider format', () => {
    const repository = createProviderRepository(
      createMemoryStorage({
        version: 1,
        bridges: [
          {
            bridgeId: 'bridge-1',
            bridgeIp: '192.0.2.1',
            name: 'Home',
            applicationKey: 'key-bridge-1',
            swVersion: '1978074000',
          },
        ],
      }),
    );

    expect(repository.list()).toEqual([
      {
        kind: 'hue',
        id: 'bridge-1',
        address: '192.0.2.1',
        name: 'Home',
        applicationKey: 'key-bridge-1',
        modelId: undefined,
        swVersion: '1978074000',
      },
    ]);
  });

  it('never exposes the secret in what listHubs sends over IPC', () => {
    const summaries = withTwo().list().map(toHubSummary);

    for (const summary of summaries) {
      expect(summary).not.toHaveProperty('applicationKey');
    }
    expect(summaries[0]).toEqual({
      id: 'bridge-2',
      kind: 'hue',
      name: 'Office',
      address: '192.0.2.2',
      modelId: undefined,
      swVersion: undefined,
    });
  });
});
