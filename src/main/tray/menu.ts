import type { MenuItemConstructorOptions } from 'electron';

import type { Action, ResourceRef, Room, Scene } from '../../shared/models';

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
}

export interface TrayHandlers {
  action(action: Action): void;
  show(): void;
  quit(): void;
}

/** A menu listing forty lights is useless; these caps keep it glanceable. */
export const MAX_FAVORITES = 8;
export const MAX_ROOMS = 6;

export function buildTrayMenuTemplate(
  snapshot: TraySnapshot,
  on: TrayHandlers,
): MenuItemConstructorOptions[] {
  const open: MenuItemConstructorOptions = { label: 'Otwórz Hue Desktop', click: on.show };
  const quit: MenuItemConstructorOptions = { label: 'Zakończ', click: on.quit };

  // Nothing below this point can be acted on without a bridge, and offering
  // dead switches is worse than offering none.
  if (!snapshot.connected) {
    return [
      { label: 'Brak połączenia z Hue Bridge', enabled: false },
      { type: 'separator' },
      open,
      quit,
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
    items.push({ label: 'Ulubione', enabled: false });
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
    items.push({ label: 'Pokoje', enabled: false });
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
        label: `Pozostałe pokoje (${snapshot.rooms.length - shownRooms.length})…`,
        click: on.show,
      });
    }
    items.push({ type: 'separator' });
  }

  items.push({
    label: 'Wyłącz wszystko',
    enabled: snapshot.rooms.some((room) => room.isOn),
    click: () => on.action({ kind: 'allOff' }),
  });
  items.push({ type: 'separator' }, open, quit);

  return items;
}
