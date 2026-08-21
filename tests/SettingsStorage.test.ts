import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings is now the store behind favourites too, so a corrupt or half-written
 * file must not take the app down with it.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hue-settings-'));

vi.mock('electron', () => ({ app: { getPath: () => dir } }));

const { createSettingsStorage } = await import('../src/main/storage/SettingsStorage');

const file = path.join(dir, 'settings.json');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('SettingsStorage', () => {
  beforeEach(() => fs.rmSync(file, { force: true }));

  it('starts from defaults when nothing has been written yet', () => {
    expect(createSettingsStorage().get()).toEqual({ theme: 'system', favorites: [] });
  });

  it('falls back to defaults rather than throwing on a corrupt file', () => {
    fs.writeFileSync(file, '{ this is not json');

    expect(createSettingsStorage().get().theme).toBe('system');
  });

  it('fills in fields missing from an older settings file', () => {
    // A file written before favourites existed must not yield `undefined`.
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark' }));

    const settings = createSettingsStorage().get();
    expect(settings.theme).toBe('dark');
    expect(settings.favorites).toEqual([]);
  });

  it('keeps the other fields when patching one', () => {
    const storage = createSettingsStorage();
    storage.set({ theme: 'dark' });

    const next = storage.set({ favorites: [{ type: 'room', id: 'room-1' }] });

    expect(next.theme).toBe('dark');
    expect(next.favorites).toEqual([{ type: 'room', id: 'room-1' }]);
    expect(createSettingsStorage().get()).toEqual(next);
  });
});
