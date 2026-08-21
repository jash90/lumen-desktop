import path from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';

import type { Action } from '../../shared/models';
import { buildTrayMenuTemplate, type TraySnapshot } from './menu';

/**
 * The menu bar / system tray entry.
 *
 * Three platform facts shape this file:
 *   - macOS wants a template image (black + alpha) so the icon inverts with the
 *     menu bar; a colour icon looks wrong in dark mode.
 *   - Windows does not open a context menu on left click, so that gets wired to
 *     showing the window instead.
 *   - Linux without a StatusNotifier host cannot create a tray at all, which
 *     must never take the app down with it.
 */

export interface TrayController {
  rebuild(): void;
  destroy(): void;
}

export interface TrayDependencies {
  snapshot(): TraySnapshot;
  run(action: Action): void;
  show(): void;
  quit(): void;
}

const REBUILD_DEBOUNCE_MS = 250;

function iconPath(): string {
  // extraResource copies the file flat into Resources/, while in development the
  // repo layout still applies.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'trayTemplate.png')
    : path.join(app.getAppPath(), 'assets', 'trayTemplate.png');
}

export function createTray(deps: TrayDependencies): TrayController {
  let tray: Tray | null = null;
  let timer: NodeJS.Timeout | null = null;

  const render = (): void => {
    if (!tray) return;
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate(deps.snapshot(), {
          action: deps.run,
          show: deps.show,
          quit: deps.quit,
        }),
      ),
    );
  };

  try {
    const image = nativeImage.createFromPath(iconPath());
    // Without this macOS renders the artwork as-is instead of tinting it.
    image.setTemplateImage(true);

    tray = new Tray(image);
    tray.setToolTip('Hue Desktop');

    // On Windows and Linux a left click has to do something useful, because the
    // context menu is bound to the right button there.
    if (process.platform !== 'darwin') tray.on('click', deps.show);

    render();
  } catch (error) {
    // A missing StatusNotifier host on Linux lands here; the app runs on without
    // a tray rather than failing to start.
    console.warn('[tray] unavailable on this system:', error);
  }

  return {
    rebuild() {
      // Every SSE event would otherwise rebuild the menu; the tray only needs to
      // be right by the time someone opens it.
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, REBUILD_DEBOUNCE_MS);
    },

    destroy() {
      if (timer) clearTimeout(timer);
      tray?.destroy();
      tray = null;
    },
  };
}
