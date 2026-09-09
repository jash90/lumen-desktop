import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Renaming the app moves `app.getPath('userData')`, so without this the previous
 * installation's favorites and shortcuts simply vanish. The marker file is what
 * keeps a second run from resurrecting files the user has since deleted.
 */

vi.mock('electron', () => ({ app: { getPath: () => '' } }));

const { migrateUserData, removeLegacyWidgetCredentials } = await import(
  '../src/main/migrateUserData',
);

let root: string;
let current: string;
let legacy: string;

const setup = (): void => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-migrate-'));
  current = path.join(root, 'Lumen Desktop');
  legacy = path.join(root, 'Hue Desktop');
  fs.mkdirSync(legacy, { recursive: true });
};

beforeEach(setup);

describe('migrateUserData', () => {
  it('carries the previous settings and credentials across', () => {
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(legacy, 'credentials.enc'), 'ciphertext');

    const report = migrateUserData(current, legacy, () => undefined);

    expect(report.migrated).toBe(true);
    expect(report.files).toEqual(['settings.json', 'credentials.enc']);
    expect(fs.readFileSync(path.join(current, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}');
  });

  it('runs once — a migrated file the user deleted stays deleted', () => {
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{}');
    migrateUserData(current, legacy, () => undefined);
    fs.rmSync(path.join(current, 'settings.json'));

    const second = migrateUserData(current, legacy, () => undefined);

    expect(second.migrated).toBe(false);
    expect(fs.existsSync(path.join(current, 'settings.json'))).toBe(false);
  });

  it('never overwrites what this installation already wrote', () => {
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"theme":"dark"}');
    fs.mkdirSync(current, { recursive: true });
    fs.writeFileSync(path.join(current, 'settings.json'), '{"theme":"light"}');

    migrateUserData(current, legacy, () => undefined);

    expect(fs.readFileSync(path.join(current, 'settings.json'), 'utf8')).toBe('{"theme":"light"}');
  });

  it('drops the old autostart entry, which would still launch the old binary', () => {
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{}');
    const removeLegacyAutostart = vi.fn();

    migrateUserData(current, legacy, removeLegacyAutostart);

    expect(removeLegacyAutostart).toHaveBeenCalledOnce();
  });

  /**
   * The rename moved the App Group, so the container the old name owned is
   * orphaned — and the file in it holds a usable key for a bridge this install
   * can no longer see. Nothing else would ever remove it.
   */
  it('removes the widget key stranded in the old App Group', () => {
    const group = 'TEAMID.com.example.old';
    const container = path.join(root, 'Library', 'Group Containers', group);
    fs.mkdirSync(container, { recursive: true });
    fs.writeFileSync(path.join(container, 'widget-credentials.json'), '[{"applicationKey":"x"}]');
    fs.writeFileSync(path.join(container, 'widget-state.json'), '{}');

    expect(removeLegacyWidgetCredentials(root, group)).toBe(true);

    expect(fs.existsSync(path.join(container, 'widget-credentials.json'))).toBe(false);
    // The snapshot carries no secret and is left where it is.
    expect(fs.existsSync(path.join(container, 'widget-state.json'))).toBe(true);
  });

  it('says nothing happened when there is no old container', () => {
    expect(removeLegacyWidgetCredentials(root, 'TEAMID.com.example.absent')).toBe(false);
  });

  it('does nothing on a fresh install, and leaves no marker to trip over', () => {
    fs.rmSync(legacy, { recursive: true });

    const report = migrateUserData(current, legacy, () => undefined);

    expect(report.migrated).toBe(false);
    expect(fs.existsSync(current)).toBe(false);
  });
});
