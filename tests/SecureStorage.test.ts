import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for a bug found by running the packaged app: an ad-hoc signed
 * macOS build cannot reach the Keychain, and a throwing read took bridge
 * discovery and startup down with it — leaving an app that could not even be
 * re-paired.
 */

const state = { available: true, dir: '' };

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    // Reversed so a test asserting "the plaintext is not on disk" is testing the
    // production code path rather than a passthrough mock.
    encryptString: (value: string) => Buffer.from([...value].reverse().join('')),
    decryptString: (buffer: Buffer) => [...buffer.toString()].reverse().join(''),
  },
}));

const { createSecureStorage } = await import('../src/main/storage/SecureStorage');

beforeEach(() => {
  state.available = true;
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hue-storage-'));
});

afterEach(() => {
  fs.rmSync(state.dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('SecureStorage', () => {
  it('round-trips a value through the keystore', () => {
    const storage = createSecureStorage();
    storage.write({ bridges: ['a'] });
    expect(storage.read()).toEqual({ bridges: ['a'] });
  });

  it('writes only what safeStorage produced, never the plaintext key', () => {
    const storage = createSecureStorage();
    storage.write({ applicationKey: 'super-secret-key' });

    const raw = fs.readFileSync(path.join(state.dir, 'credentials.enc'), 'utf8');
    expect(raw).not.toContain('super-secret-key');
    expect(storage.read()).toEqual({ applicationKey: 'super-secret-key' });
  });

  it('keeps the credentials file private to the user', () => {
    createSecureStorage().write({ applicationKey: 'k' });
    const mode = fs.statSync(path.join(state.dir, 'credentials.enc')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('reports "not paired" instead of throwing when the keystore is unreachable', () => {
    const storage = createSecureStorage();
    storage.write({ applicationKey: 'k' });

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.available = false;

    expect(() => storage.read()).not.toThrow();
    expect(storage.read()).toBeNull();
  });

  it('still refuses to write when the keystore is unreachable', () => {
    state.available = false;
    expect(() => createSecureStorage().write({ a: 1 })).toThrow(
      expect.objectContaining({ code: 'StorageUnavailable' }),
    );
  });

  it('discards an undecryptable blob rather than blocking the app forever', () => {
    const storage = createSecureStorage();
    fs.writeFileSync(path.join(state.dir, 'credentials.enc'), 'not-really-encrypted');

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(storage.read()).toBeNull();
  });

  it('flags a weak backend so the UI can warn (PRD §63.3)', () => {
    state.available = false;
    expect(createSecureStorage().health().weak).toBe(true);
  });
});
