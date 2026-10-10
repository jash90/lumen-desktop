import type { MenuItemConstructorOptions } from 'electron';

import type { UpdateStatus } from '../../shared/ipc';
import type { Action, ResourceRef, Room, Scene } from '../../shared/models';
import { PRODUCT_NAME } from '../../shared/identity';
import { t } from '../../shared/i18n';

/**
 * Builds the tray menu template.
 *
 * Kept free of any electron runtime import — only the type, which TypeScript
 * erases — so the whole layout can be unit tested without an Electron process.
 */

export interface TraySnapshot {
  connected: boolean;
  rooms: Room[];
  scenes: Scene[];
  favorites: ResourceRef[];
  /** Absent, or `unsupported` in a development run, hides the update item. */
  update?: UpdateStatus;
}

export interface TrayHandlers {
  action(action: Action): void;
  show(): void;
  quit(): void;
  checkForUpdates(): void;
  installUpdate(): void;
}

/** A menu listing forty lights is useless; these caps keep it glanceable. */
export const MAX_FAVORITES = 8;
export const MAX_ROOMS = 6;

/** The update entry, whose label and action follow where the update stands. */
export function updateMenuItem(
  update: UpdateStatus | undefined,
  on: Pick<TrayHandlers, 'checkForUpdates' | 'installUpdate'>,
): MenuItemConstructorOptions | null {
  switch (update?.state) {
    case undefined:
    case 'unsupported':
      return null;
    case 'checking':
      return { label: t('tray.checkingUpdates'), enabled: false };
    case 'downloading':
      return { label: t('tray.downloadingUpdate'), enabled: false };
    case 'ready':
      return {
        label: t('tray.restartToUpdate', { version: update.version }),
        click: on.installUpdate,
      };
    case 'available':
      return {
        label: t('tray.downloadVersion', { version: update.version }),
        click: on.installUpdate,
      };
    default:
      return { label: t('tray.checkForUpdates'), click: on.checkForUpdates };
  }
}

export function buildTrayMenuTemplate(
  snapshot: TraySnapshot,
  on: TrayHandlers,
): MenuItemConstructorOptions[] {
  const open: MenuItemConstructorOptions = {
    label: t('tray.open', { product: PRODUCT_NAME }),
    click: on.show,
  };
  const quit: MenuItemConstructorOptions = { label: t('tray.quit'), click: on.quit };
  const update = updateMenuItem(snapshot.update, on);
  const footer = update ? [open, update, quit] : [open, quit];

  // Nothing below this point can be acted on without a bridge, and offering
  // dead switches is worse than offering none.
  if (!snapshot.connected) {
    return [
      { label: t('tray.noConnection'), enabled: false },
      { type: 'separator' },
      ...footer,
    ];
  }

  const items: MenuItemConstructorOptions[] = [];

  const favoriteRooms = snapshot.favorites
    .filter((favorite) => favorite.type === 'room')
    .map((favorite) => snapshot.rooms.find((room) => room.id === favorite.id))
    .filter((room): room is Room => room !== undefined)
    .slice(0, MAX_FAVORITES);

  const favoriteScenes = snapshot.favorites
    .filter((favorite) => favorite.type === 'scene')
    .map((favorite) => snapshot.scenes.find((scene) => scene.id === favorite.id))
    .filter((scene): scene is Scene => scene !== undefined)
    .slice(0, MAX_FAVORITES);

  if (favoriteRooms.length > 0 || favoriteScenes.length > 0) {
    items.push({ label: t('home.favorites'), enabled: false });
    for (const room of favoriteRooms) {
      items.push({
        label: room.name,
        type: 'checkbox',
        checked: room.isOn,
        click: () => on.action({ kind: 'toggleRoom', id: room.id }),
      });
    }
    for (const scene of favoriteScenes) {
      items.push({
        label: scene.name,
        click: () => on.action({ kind: 'activateScene', id: scene.id }),
      });
    }
    items.push({ type: 'separator' });
  }

  const shownRooms = snapshot.rooms.slice(0, MAX_ROOMS);
  if (shownRooms.length > 0) {
    items.push({ label: t('tray.rooms'), enabled: false });
    for (const room of shownRooms) {
      items.push({
        label: room.name,
        type: 'checkbox',
        checked: room.isOn,
        click: () => on.action({ kind: 'toggleRoom', id: room.id }),
      });
    }
    if (snapshot.rooms.length > shownRooms.length) {
      items.push({
        label: t('tray.otherRooms', { count: snapshot.rooms.length - shownRooms.length }),
        click: on.show,
      });
    }
    items.push({ type: 'separator' });
  }

  items.push({
    label: t('action.allOff'),
    enabled: snapshot.rooms.some((room) => room.isOn),
    click: () => on.action({ kind: 'allOff' }),
  });
  items.push({ type: 'separator' }, ...footer);

  return items;
}
