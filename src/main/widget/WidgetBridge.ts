import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import type { Light, Room } from '../../shared/models';

/**
 * Feeds the macOS WidgetKit extension (PRD §26 in spirit — glanceable control
 * outside the app window).
 *
 * The widget is deliberately read-only and never talks to the bridge, so the Hue
 * application key stays in the app's Keychain-backed storage and never reaches a
 * second process. All the widget gets is this small denormalised snapshot.
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

export interface WidgetBridge {
  publish(connected: boolean, rooms: readonly Room[], lights: readonly Light[]): void;
}

const FILE_NAME = 'widget-state.json';
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

export function createWidgetBridge(): WidgetBridge {
  // Only macOS has WidgetKit; everywhere else this is a no-op.
  if (process.platform !== 'darwin') {
    return { publish: () => undefined };
  }

  const containerPath = path.join(
    app.getPath('home'),
    'Library',
    'Group Containers',
    APP_GROUP,
  );
  const filePath = path.join(containerPath, FILE_NAME);
  const helperPath = path.join(path.dirname(app.getPath('exe')), RELOAD_HELPER);
  let lastPayload = '';

  return {
    publish(connected, rooms, lights) {
      const payload = JSON.stringify(buildSnapshot(connected, rooms, lights));
      // Every SSE event would otherwise rewrite the file and wake WidgetKit even
      // when nothing the widget shows has actually changed.
      if (payload === lastPayload) return;
      lastPayload = payload;

      try {
        // The app is not sandboxed, so it can create the shared container itself
        // rather than waiting for the widget to be run first.
        fs.mkdirSync(containerPath, { recursive: true });
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, payload);
        fs.renameSync(tempPath, filePath);
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
  };
}
