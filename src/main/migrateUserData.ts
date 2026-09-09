import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { legacyDesktopEntryPath } from './autostart';
import { LEGACY_APP_GROUP, LEGACY_PRODUCT_NAME } from '../shared/identity';

/**
 * The product name feeds `app.getPath('userData')`, so renaming the app moves
 * its whole data directory and it starts as if it had never run. This carries
 * the previous installation's files across, once.
 *
 * What it cannot carry: on macOS the `safeStorage` key lives in the Keychain
 * under the *app name*, so `credentials.enc` is copied but will not decrypt —
 * the bridge has to be paired again. `SecureStorage.read()` returns `null` for
 * an undecryptable blob rather than throwing, so that lands the user in
 * onboarding instead of an error. On Windows (DPAPI, bound to the user) and on
 * Linux the copy is usable as it is.
 */

const MARKER = '.migrated';
const FILES = ['settings.json', 'credentials.enc'];

export interface MigrationReport {
  /** False when there was nothing to do — already migrated, or a fresh install. */
  migrated: boolean;
  files: string[];
}

/**
 * Deletes the widget export the previous name left behind.
 *
 * The rename moved the App Group, so the old container is orphaned — and the
 * file in it holds a usable application key in plaintext, mode 0600, for a
 * bridge this installation can no longer even see. Nothing else will ever clean
 * it up: the app only writes to its current container.
 *
 * The snapshot beside it is harmless and left alone; this removes the secret.
 */
export function removeLegacyWidgetCredentials(home: string, appGroup: string): boolean {
  const target = path.join(home, 'Library', 'Group Containers', appGroup, 'widget-credentials.json');
  try {
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, { force: true });
    return true;
  } catch (error) {
    console.warn('[migration] could not remove the old widget credentials:', error);
    return false;
  }
}

export function migrateUserData(
  currentDir: string,
  legacyDir: string,
  removeLegacyAutostart: () => void,
): MigrationReport {
  const marker = path.join(currentDir, MARKER);
  const done = { migrated: false, files: [] as string[] };

  // The marker is what makes this idempotent: without it, deleting a migrated
  // file here would pull the stale copy back on the next launch.
  if (fs.existsSync(marker)) return done;
  if (path.resolve(currentDir) === path.resolve(legacyDir)) return done;

  const copied: string[] = [];
  try {
    if (!fs.existsSync(legacyDir)) return done;

    fs.mkdirSync(currentDir, { recursive: true });
    for (const file of FILES) {
      const from = path.join(legacyDir, file);
      const to = path.join(currentDir, file);
      // Never overwrite: a file already here was written by this installation
      // and is newer than anything the old one left behind.
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.copyFileSync(from, to);
      copied.push(file);
    }

    removeLegacyAutostart();
    fs.writeFileSync(marker, new Date().toISOString());
  } catch (error) {
    // A failed migration must not stop the app from starting — the worst case
    // is an empty profile, which is exactly what a fresh install looks like.
    console.warn('[migration] could not carry over the previous data:', error);
    return { migrated: copied.length > 0, files: copied };
  }

  return { migrated: copied.length > 0, files: copied };
}

/** Wires the pure function above to the real paths. Call once, before any read. */
export function runUserDataMigration(): MigrationReport {
  const currentDir = app.getPath('userData');
  const legacyDir = path.join(path.dirname(currentDir), LEGACY_PRODUCT_NAME);

  const report = migrateUserData(currentDir, legacyDir, () => {
    if (process.platform === 'linux') {
      fs.rmSync(legacyDesktopEntryPath(), { force: true });
    }
  });

  if (report.migrated) {
    console.info('[migration] carried over from the previous name:', report.files.join(', '));
  }

  // Unconditional, not part of the one-shot migration above: the marker may
  // already be set from an earlier run that did not know to do this.
  if (process.platform === 'darwin') {
    if (removeLegacyWidgetCredentials(app.getPath('home'), LEGACY_APP_GROUP)) {
      console.info('[migration] removed the widget key left in the old App Group');
    }
  }

  return report;
}
