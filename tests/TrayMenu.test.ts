import { describe, expect, it, vi } from 'vitest';

import { PRODUCT_NAME } from '../src/shared/identity';

import {
  buildTrayMenuTemplate,
  MAX_ROOMS,
  type TraySnapshot,
} from '../src/main/tray/menu';
import type { Room, Scene } from '../src/shared/models';

const room = (id: string, name: string, isOn = true): Room => ({
  id,
  providerId: 'bridge-1',
  name,
  lightIds: [`${id}-a`],
  isOn,
  brightness: isOn ? 70 : 0,
  supportsGroupControl: true,
});

const scene = (id: string, name: string): Scene => ({
  id,
  providerId: 'bridge-1',
  name,
  roomId: 'room-1',
  isActive: false,
});

const handlers = () => ({ action: vi.fn(), show: vi.fn(), quit: vi.fn() });

const labels = (snapshot: TraySnapshot) =>
  buildTrayMenuTemplate(snapshot, handlers()).map((item) => item.label);

const base: TraySnapshot = { connected: true, rooms: [], scenes: [], favorites: [] };

describe('buildTrayMenuTemplate', () => {
  it('offers nothing actionable while the bridge is unreachable', () => {
    // Dead switches are worse than no switches.
    expect(labels({ ...base, connected: false, rooms: [room('room-1', 'Living Room')] })).toEqual([
      'No connection to the Hue Bridge',
      undefined,
      `Open ${PRODUCT_NAME}`,
      'Quit',
    ]);
  });

  it('puts favourites above the plain room list', () => {
    const result = labels({
      ...base,
      rooms: [room('room-1', 'Living Room'), room('room-2', 'Office')],
      favorites: [{ type: 'room', id: 'room-2' }],
    });

    expect(result.indexOf('Favorites')).toBeLessThan(result.indexOf('Rooms'));
  });

  it('includes favourite scenes, not just rooms', () => {
    const result = labels({
      ...base,
      rooms: [room('room-1', 'Living Room')],
      scenes: [scene('scene-1', 'Relax')],
      favorites: [{ type: 'scene', id: 'scene-1' }],
    });

    expect(result).toContain('Relax');
  });

  it('ignores favourites the bridge no longer reports', () => {
    const result = labels({
      ...base,
      rooms: [room('room-1', 'Living Room')],
      favorites: [{ type: 'room', id: 'room-gone' }],
    });

    expect(result).not.toContain('Favorites');
  });

  it('caps the room list and points the rest at the window', () => {
    const rooms = Array.from({ length: MAX_ROOMS + 3 }, (_, i) => room(`r${i}`, `Room ${i}`));

    const result = labels({ ...base, rooms });

    expect(result).toContain('Other rooms (3)…');
    expect(result.filter((label) => label?.startsWith('Room '))).toHaveLength(MAX_ROOMS);
  });

  it('disables "all off" when nothing is on', () => {
    const template = buildTrayMenuTemplate(
      { ...base, rooms: [room('room-1', 'Living Room', false)] },
      handlers(),
    );

    expect(template.find((item) => item.label === 'All off')?.enabled).toBe(false);
  });

  it('sends the room toggle as an action rather than calling the bridge itself', () => {
    const on = handlers();
    const template = buildTrayMenuTemplate({ ...base, rooms: [room('room-1', 'Living Room')] }, on);

    const item = template.find((entry) => entry.label === 'Living Room');
    expect(item?.checked).toBe(true);
    item?.click?.(undefined as never, undefined, undefined as never);
    expect(on.action).toHaveBeenCalledWith({ kind: 'toggleRoom', id: 'room-1' });
  });
});
