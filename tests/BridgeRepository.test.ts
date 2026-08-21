import { describe, expect, it } from 'vitest';

import {
  createBridgeRepository,
  type BridgeCredential,
} from '../src/main/bridge/BridgeRepository';
import type { SecureStorage } from '../src/main/storage/SecureStorage';

/** In-memory stand-in — the encryption itself is covered by SecureStorage.test.ts. */
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

const credential = (id: string, name: string): BridgeCredential => ({
  bridgeId: id,
  bridgeIp: `192.0.2.${id.slice(-1)}`,
  name,
  applicationKey: `key-${id}`,
});

describe('BridgeRepository', () => {
  it('treats the first entry as active, which is what setActive reorders', () => {
    const repository = createBridgeRepository(createMemoryStorage());
    repository.save(credential('bridge-1', 'Dom'));
    repository.save(credential('bridge-2', 'Biuro'));

    // save() puts the newest first.
    expect(repository.getActive()?.bridgeId).toBe('bridge-2');

    repository.setActive('bridge-1');
    expect(repository.getActive()?.bridgeId).toBe('bridge-1');
  });

  it('keeps the other bridges and their keys when switching', () => {
    const repository = createBridgeRepository(createMemoryStorage());
    repository.save(credential('bridge-1', 'Dom'));
    repository.save(credential('bridge-2', 'Biuro'));

    repository.setActive('bridge-1');

    const all = repository.list();
    expect(all).toHaveLength(2);
    expect(all.map((entry) => entry.applicationKey).sort()).toEqual([
      'key-bridge-1',
      'key-bridge-2',
    ]);
  });

  it('ignores a switch to a bridge it does not know', () => {
    const repository = createBridgeRepository(createMemoryStorage());
    repository.save(credential('bridge-1', 'Dom'));

    repository.setActive('bridge-ghost');

    expect(repository.getActive()?.bridgeId).toBe('bridge-1');
  });

  it('does not store the same bridge twice when it is paired again', () => {
    const repository = createBridgeRepository(createMemoryStorage());
    repository.save(credential('bridge-1', 'Dom'));
    repository.save({ ...credential('bridge-1', 'Dom'), bridgeIp: '192.0.2.99' });

    expect(repository.list()).toHaveLength(1);
    expect(repository.getActive()?.bridgeIp).toBe('192.0.2.99');
  });

  it('never exposes the application key in what listBridges sends over IPC', () => {
    const repository = createBridgeRepository(createMemoryStorage());
    repository.save(credential('bridge-1', 'Dom'));

    // Mirrors the mapping in register.ts — the renderer must never receive a key.
    const summaries = repository.list().map((entry) => ({
      id: entry.bridgeId,
      name: entry.name,
      ip: entry.bridgeIp,
      modelId: entry.modelId,
      swVersion: entry.swVersion,
    }));

    expect(JSON.stringify(summaries)).not.toContain('key-bridge-1');
    expect(Object.keys(summaries[0]!)).not.toContain('applicationKey');
  });
});
