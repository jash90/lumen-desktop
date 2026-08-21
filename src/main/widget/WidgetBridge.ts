import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import type { BridgeCredential } from '../bridge/BridgeRepository';
import type { Light, Room } from '../../shared/models';

/**
 * Feeds the macOS WidgetKit extension (PRD §26 in spirit — glanceable control
 * outside the app window).
 *
 * Two files go into the shared App Group container:
 *
 *   - `widget-state.json` — a denormalised snapshot of what the app currently
 *     knows. The widget falls back to it when the bridge is unreachable.
 *   - `widget-credentials.json` — bridge address and application key, so the
 *     widget can query and control the bridge on its own, including while the
 *     app is not running.
 *
 * Exporting the key is a deliberate trade-off: it leaves the Keychain-backed
 * store for a 0600 file readable by anything running as this user. A Hue
 * application key only grants control of local lighting — it is not an account
 * credential — and unpairing deletes the file again.
 */

export interface WidgetRoom {
  id: string;
  name: string;
  isOn: boolean;
  brightness: number;
  lightCount: number;
}

export interface WidgetSnapshot {
  connected: boolean;
  rooms: WidgetRoom[];
  lightsOn: number;
  lightsTotal: number;
}

/** What the widget needs to reach the bridge itself. */
export interface WidgetCredentials {
  bridgeId: string;
  ip: string;
  applicationKey: string;
}

export interface WidgetBridge {
  publish(connected: boolean, rooms: readonly Room[], lights: readonly Light[]): void;
  /** `null` removes the exported key — that is what unpairing does. */
  publishCredentials(credential: BridgeCredential | null): void;
}

const FILE_NAME = 'widget-state.json';
const CREDENTIALS_FILE = 'widget-credentials.json';
/** Helper inside the app bundle; absent in development, where there is no bundle. */
const RELOAD_HELPER = 'hue-widget-reload';
/**
 * The widget extension is sandboxed, so its own Application Support directory
 * points inside its private container rather than at ours. The App Group
 * container is the one path both processes can reach — team-prefixed, as macOS
 * expects (iOS uses a "group." prefix instead).
 */
const APP_GROUP = 'H2X8YGN869.com.bartlomiejzimny.huedesktop';

export function buildSnapshot(
  connected: boolean,
  rooms: readonly Room[],
  lights: readonly Light[],
): WidgetSnapshot {
  return {
    connected,
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      isOn: room.isOn,
      brightness: room.brightness,
      lightCount: room.lightIds.length,
    })),
    lightsOn: lights.filter((light) => light.isOn).length,
    lightsTotal: lights.length,
  };
}

export function toCredentials(credential: BridgeCredential): WidgetCredentials {
  return {
    bridgeId: credential.bridgeId,
    ip: credential.bridgeIp,
    applicationKey: credential.applicationKey,
  };
}

export function createWidgetBridge(): WidgetBridge {
  // Only macOS has WidgetKit; everywhere else this is a no-op.
  if (process.platform !== 'darwin') {
    return { publish: () => undefined, publishCredentials: () => undefined };
  }

  const containerPath = path.join(
    app.getPath('home'),
    'Library',
    'Group Containers',
    APP_GROUP,
  );
  const filePath = path.join(containerPath, FILE_NAME);
  const credentialsPath = path.join(containerPath, CREDENTIALS_FILE);
  const helperPath = path.join(path.dirname(app.getPath('exe')), RELOAD_HELPER);
  let lastPayload = '';
  let lastCredentials = '';

  /**
   * The widget may read at any moment, so the file must never be seen
   * half-written — hence write-then-rename rather than a plain write.
   */
  const writeAtomic = (target: string, payload: string, mode: number): void => {
    // The app is not sandboxed, so it can create the shared container itself
    // rather than waiting for the widget to be run first.
    fs.mkdirSync(containerPath, { recursive: true });
    const tempPath = `${target}.tmp`;
    fs.writeFileSync(tempPath, payload, { mode });
    fs.renameSync(tempPath, target);
  };

  return {
    publish(connected, rooms, lights) {
      const payload = JSON.stringify(buildSnapshot(connected, rooms, lights));
      // Every SSE event would otherwise rewrite the file and wake WidgetKit even
      // when nothing the widget shows has actually changed.
      if (payload === lastPayload) return;
      lastPayload = payload;

      try {
        writeAtomic(filePath, payload, 0o644);
      } catch (error) {
        console.warn('[widget] could not write snapshot:', error);
        return;
      }

      // WidgetCenter can only be reached from native code, so a tiny helper
      // binary shipped in the bundle does the reload. Missing helper (dev mode)
      // just means the widget refreshes on its own schedule instead.
      if (!fs.existsSync(helperPath)) return;
      execFile(helperPath, (error) => {
        if (error) console.warn('[widget] reload helper failed:', error.message);
      });
    },

    publishCredentials(credential) {
      const payload = credential ? JSON.stringify(toCredentials(credential)) : '';
      if (payload === lastCredentials) return;
      lastCredentials = payload;

      try {
        if (!credential) {
          fs.rmSync(credentialsPath, { force: true });
          return;
        }
        // 0600: the key is no longer Keychain-protected once it lives here, so at
        // least keep it off other accounts on the machine.
        writeAtomic(credentialsPath, payload, 0o600);
      } catch (error) {
        console.warn('[widget] could not write credentials:', error);
        lastCredentials = '';
      }
    },
  };
}
