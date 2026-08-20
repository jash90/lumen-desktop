import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

import { HueError } from '../../shared/errors';
import type { StorageHealth } from '../../shared/models';

/**
 * Credential storage backed by the OS keystore (PRD §20).
 *
 * Application keys are encrypted with Electron's safeStorage — Keychain on
 * macOS, DPAPI on Windows, the desktop secret service on Linux — and only the
 * ciphertext is written to disk. Plaintext keys never touch settings.json,
 * localStorage or any log line.
 */

export interface SecureStorage {
  read<T>(): T | null;
  write(value: unknown): void;
  clear(): void;
  health(): StorageHealth;
}

/**
 * Electron only exposes the backend name on Linux, where `basic_text` means the
 * "encryption" is a hardcoded key and offers no real protection. The UI warns in
 * that case rather than pretending the key is safe.
 */
function inspectHealth(): StorageHealth {
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  let backend: string | null = null;

  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    try {
      backend = safeStorage.getSelectedStorageBackend();
    } catch {
      backend = null;
    }
  }

  return {
    encryptionAvailable,
    backend,
    weak: !encryptionAvailable || backend === 'basic_text',
  };
}

export function createSecureStorage(fileName = 'credentials.enc'): SecureStorage {
  const filePath = path.join(app.getPath('userData'), fileName);

  return {
    read<T>(): T | null {
      if (!fs.existsSync(filePath)) return null;
      if (!safeStorage.isEncryptionAvailable()) {
        // Reading must never be fatal. An ad-hoc signed macOS build or a Linux box
        // with no secret service cannot reach the keystore at all, and throwing
        // here took down bridge discovery and startup with it — leaving an app
        // that could not even be re-paired. Report "not paired" instead; health()
        // is what tells the user their credentials are not protected.
        console.warn('[storage] keystore unavailable; ignoring stored credentials');
        return null;
      }
      try {
        const decrypted = safeStorage.decryptString(fs.readFileSync(filePath));
        return JSON.parse(decrypted) as T;
      } catch (error) {
        // A keystore reset or a different machine makes the blob undecryptable.
        // Treat it as "not paired" rather than blocking the app forever.
        console.warn('[storage] discarding unreadable credentials:', error);
        return null;
      }
    },

    write(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new HueError('StorageUnavailable', 'safeStorage is not available');
      }
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      // Write-then-rename so an interrupted write cannot leave a half-file that
      // locks the user out of their bridge.
      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, encrypted, { mode: 0o600 });
      fs.renameSync(tempPath, filePath);
    },

    clear() {
      fs.rmSync(filePath, { force: true });
    },

    health: inspectHealth,
  };
}
