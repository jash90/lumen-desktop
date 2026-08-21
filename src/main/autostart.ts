import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

/**
 * "Start with the system", which means something different on all three
 * platforms:
 *
 *   - Windows: process.execPath points inside a versioned Squirrel folder that
 *     disappears on the next update, so the registry entry has to go through
 *     Update.exe instead.
 *   - macOS 13+: openAsHidden is ignored under SMAppService, so starting in the
 *     background is done with our own --hidden argument.
 *   - Linux: Electron has no setLoginItemSettings at all; a desktop entry is
 *     the honest fallback.
 */

export const HIDDEN_FLAG = '--hidden';

export interface LoginItemPlan {
  supported: boolean;
  settings?: Electron.Settings;
}

/** Pure so the platform rules can be tested without an Electron process. */
export function loginItemSettingsFor(
  platform: NodeJS.Platform,
  enabled: boolean,
  execPath: string,
): LoginItemPlan {
  if (platform === 'win32') {
    return {
      supported: true,
      settings: {
        openAtLogin: enabled,
        // Squirrel's stub survives updates; the versioned exe does not.
        path: path.resolve(execPath, '..', '..', 'Update.exe'),
        args: [
          '--processStart',
          `"${path.basename(execPath)}"`,
          '--process-start-args',
          `"${HIDDEN_FLAG}"`,
        ],
      },
    };
  }

  if (platform === 'darwin') {
    return { supported: true, settings: { openAtLogin: enabled, args: [HIDDEN_FLAG] } };
  }

  return { supported: false };
}

const desktopEntryPath = (): string =>
  path.join(os.homedir(), '.config', 'autostart', 'hue-desktop.desktop');

/** ponytail: minimal .desktop file rather than the full XDG autostart spec. */
function applyLinuxAutostart(enabled: boolean, execPath: string): void {
  const target = desktopEntryPath();
  if (!enabled) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Hue Desktop',
      `Exec="${execPath}" ${HIDDEN_FLAG}`,
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n'),
  );
}

export function applyLoginItem(enabled: boolean): void {
  const plan = loginItemSettingsFor(process.platform, enabled, process.execPath);

  try {
    if (plan.supported && plan.settings) {
      app.setLoginItemSettings(plan.settings);
      return;
    }
    applyLinuxAutostart(enabled, process.execPath);
  } catch (error) {
    // A sandboxed or locked-down system can refuse this; the preference is not
    // worth failing a settings write over.
    console.warn('[autostart] could not apply login item:', error);
  }
}

/** True when the OS started us in the background rather than the user opening the app. */
export const startedHidden = (): boolean => process.argv.includes(HIDDEN_FLAG);
