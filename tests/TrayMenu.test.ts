import { describe, expect, it, vi } from 'vitest';

import {
  buildTrayMenuTemplate,
  MAX_ROOMS,
  type TraySnapshot,
} from '../src/main/tray/menu';
import type { Room, Scene } from '../src/shared/models';

const room = (id: string, name: string, isOn = true): Room => ({
  id,
  name,
  lightIds: [`${id}-a`],
  isOn,
  brightness: isOn ? 70 : 0,
  supportsGroupControl: true,
});

const scene = (id: string, name: string): Scene => ({ id, name, roomId: 'room-1', isActive: false });

const handlers = () => ({ action: vi.fn(), show: vi.fn(), quit: vi.fn() });

const labels = (snapshot: TraySnapshot) =>
  buildTrayMenuTemplate(snapshot, handlers()).map((item) => item.label);

const base: TraySnapshot = { connected: true, rooms: [], scenes: [], favorites: [] };

describe('buildTrayMenuTemplate', () => {
  it('offers nothing actionable while the bridge is unreachable', () => {
    // Dead switches are worse than no switches.
    expect(labels({ ...base, connected: false, rooms: [room('room-1', 'Salon')] })).toEqual([
      'Brak połączenia z Hue Bridge',
      undefined,
      'Otwórz Hue Desktop',
      'Zakończ',
    ]);
  });

  it('puts favourites above the plain room list', () => {
    const result = labels({
      ...base,
      rooms: [room('room-1', 'Salon'), room('room-2', 'Biuro')],
      favorites: [{ type: 'room', id: 'room-2' }],
    });

    expect(result.indexOf('Ulubione')).toBeLessThan(result.indexOf('Pokoje'));
  });

  it('includes favourite scenes, not just rooms', () => {
    const result = labels({
      ...base,
      rooms: [room('room-1', 'Salon')],
      scenes: [scene('scene-1', 'Relaks')],
      favorites: [{ type: 'scene', id: 'scene-1' }],
    });

    expect(result).toContain('Relaks');
  });

  it('ignores favourites the bridge no longer reports', () => {
    const result = labels({
      ...base,
      rooms: [room('room-1', 'Salon')],
      favorites: [{ type: 'room', id: 'room-gone' }],
    });

    expect(result).not.toContain('Ulubione');
  });

  it('caps the room list and points the rest at the window', () => {
    const rooms = Array.from({ length: MAX_ROOMS + 3 }, (_, i) => room(`r${i}`, `Pokój ${i}`));

    const result = labels({ ...base, rooms });

    expect(result).toContain('Pozostałe pokoje (3)…');
    expect(result.filter((label) => label?.startsWith('Pokój '))).toHaveLength(MAX_ROOMS);
  });

  it('disables "wyłącz wszystko" when nothing is on', () => {
    const template = buildTrayMenuTemplate(
      { ...base, rooms: [room('room-1', 'Salon', false)] },
      handlers(),
    );

    expect(template.find((item) => item.label === 'Wyłącz wszystko')?.enabled).toBe(false);
  });

  it('sends the room toggle as an action rather than calling the bridge itself', () => {
    const on = handlers();
    const template = buildTrayMenuTemplate({ ...base, rooms: [room('room-1', 'Salon')] }, on);

    const item = template.find((entry) => entry.label === 'Salon');
    expect(item?.checked).toBe(true);
    item?.click?.(undefined as never, undefined, undefined as never);
    expect(on.action).toHaveBeenCalledWith({ kind: 'toggleRoom', id: 'room-1' });
  });
});
