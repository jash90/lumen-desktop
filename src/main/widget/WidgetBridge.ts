import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import type { ProviderCredential } from '../providers/ProviderCredential';
import { APP_GROUP, RELOAD_HELPER } from '../../shared/identity';
import type { Light, Room } from '../../shared/models';

/**
 * Feeds the macOS WidgetKit extension (PRD §26 in spirit — glanceable control
 * outside the app window).
 *
 * Two files go into the shared App Group container:
 *
 *   - `widget-state.json` — a denormalised snapshot of what the app currently
 *     knows. The widget falls back to it when a hub is unreachable.
 *   - `widget-credentials.json` — how to reach each hub, so the widget can
 *     query and control it on its own, including while the app is not running.
 *
 * Exporting a secret is a deliberate trade-off: it leaves the Keychain-backed
 * store for a 0600 file readable by anything running as this user. For Hue that
 * is defensible — an application key only grants control of lighting on the
 * local network and is not an account credential.
 *
 * A Home Assistant token is not comparable: it grants that whole API, locks and
 * cameras included, and works remotely if the instance is exposed. So it is
 * exported only when the user has explicitly turned it on. Without it the
 * widget still *shows* Home Assistant rooms from the snapshot — it just cannot
 * switch them.
 */

export interface WidgetRoom {
  id: string;
  /** Which hub to send a tap to; the widget holds a client per kind. */
  providerId: string;
  name: string;
  isOn: boolean;
  brightness: number;
  lightCount: number;
  /** False when no credential was exported — the row renders read-only. */
  controllable: boolean;
}

export interface WidgetSnapshot {
  connected: boolean;
  rooms: WidgetRoom[];
  lightsOn: number;
  lightsTotal: number;
}

/** What the widget needs to reach a hub itself, discriminated like the stored one. */
export type WidgetCredential =
  | { kind: 'hue'; providerId: string; address: string; applicationKey: string }
  | { kind: 'homeassistant'; providerId: string; address: string; token: string }
  | {
      kind: 'tuya';
      providerId: string;
      devices: { deviceId: string; name: string; address: string; localKey: string }[];
    };

export interface WidgetBridge {
  publish(
    connected: boolean,
    rooms: readonly Room[],
    lights: readonly Light[],
    controllable: ReadonlySet<string>,
  ): void;
  /** An empty list removes the file — that is what forgetting every hub does. */
  publishCredentials(credentials: readonly WidgetCredential[]): void;
}

const FILE_NAME = 'widget-state.json';
const CREDENTIALS_FILE = 'widget-credentials.json';

/*
 * `RELOAD_HELPER` names a helper inside the app bundle (absent in development,
 * where there is no bundle) and `APP_GROUP` the container both processes can
 * reach — the widget extension is sandboxed, so its own Application Support
 * directory points inside its private container rather than at ours. Both come
 * from `identity.json`, which `build-widget.sh` reads as well.
 */

export function buildSnapshot(
  connected: boolean,
  rooms: readonly Room[],
  lights: readonly Light[],
  controllable: ReadonlySet<string> = new Set(),
): WidgetSnapshot {
  return {
    connected,
    rooms: rooms.map((room) => ({
      id: room.id,
      providerId: room.providerId,
      name: room.name,
      isOn: room.isOn,
      brightness: room.brightness,
      lightCount: room.lightIds.length,
      controllable: controllable.has(room.providerId),
    })),
    lightsOn: lights.filter((light) => light.isOn).length,
    lightsTotal: lights.length,
  };
}

/**
 * Which stored hubs the widget may be given the keys to.
 *
 * Hue always; Home Assistant only behind the explicit opt-in, because its token
 * is a different order of secret — see the note at the top of this file.
 */
export function toCredentials(
  credentials: readonly ProviderCredential[],
  exportHomeAssistant: boolean,
): WidgetCredential[] {
  // Exhaustive on purpose: the old "anything that isn't Hue is Home Assistant"
  // chain would have swept a new hub kind into the Home Assistant branch, so a
  // third brand's secret could leave the keychain under a consent toggle
  // labelled for Home Assistant.
  return credentials.flatMap((credential): WidgetCredential[] => {
    switch (credential.kind) {
      case 'hue':
        return [
          {
            kind: 'hue',
            providerId: credential.id,
            address: credential.address,
            applicationKey: credential.applicationKey,
          },
        ];

      case 'homeassistant':
        return exportHomeAssistant
          ? [
              {
                kind: 'homeassistant',
                providerId: credential.id,
                address: credential.address,
                token: credential.token,
              },
            ]
          : [];

      case 'tuya':
        // Nothing yet. The Swift side has no Tuya client, so exporting the local
        // keys would write secrets to a file on disk that nothing can read —
        // all of the cost of leaving the keychain and none of the benefit. The
        // widget shows these rooms from the snapshot instead, read-only.
        //
        // When widget/TuyaClient.swift lands this becomes an unconditional
        // export, like Hue: a local key drives lighting on one network and is
        // not the class of secret a Home Assistant token is.
        return [];

      default: {
        const unreachable: never = credential;
        throw new Error(`no widget export for ${JSON.stringify(unreachable)}`);
      }
    }
  });
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
  /**
   * Deliberately not '': an empty export serialises to '' too, so seeding this
   * with the same value made the first publishCredentials([]) after start a
   * no-op — and a credentials file written by an earlier run then survived,
   * with a usable key in it, for a hub the app had already forgotten. That is
   * exactly what happens when the keychain is reset and every credential
   * suddenly reads back as null.
   */
  let lastCredentials: string | null = null;

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
    publish(connected, rooms, lights, controllable) {
      const payload = JSON.stringify(buildSnapshot(connected, rooms, lights, controllable));
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

    publishCredentials(credentials) {
      const payload = credentials.length > 0 ? JSON.stringify(credentials) : '';
      if (payload === lastCredentials) return;
      lastCredentials = payload;

      try {
        if (credentials.length === 0) {
          fs.rmSync(credentialsPath, { force: true });
          return;
        }
        // 0600: these secrets are no longer Keychain-protected once they live
        // here, so at least keep them off other accounts on the machine.
        writeAtomic(credentialsPath, payload, 0o600);
      } catch (error) {
        console.warn('[widget] could not write credentials:', error);
        // Back to "nothing known", so the next publish writes rather than
        // matching against a value that never reached the disk.
        lastCredentials = null;
      }
    },
  };
}
