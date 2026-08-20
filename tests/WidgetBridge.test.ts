import { describe, expect, it, vi } from 'vitest';

import type { Light, Room } from '../src/shared/models';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const { buildSnapshot } = await import('../src/main/widget/WidgetBridge');

const room = (over: Partial<Room>): Room => ({
  id: 'r1',
  name: 'Salon',
  lightIds: ['l1', 'l2'],
  isOn: true,
  brightness: 70,
  supportsGroupControl: true,
  ...over,
});

const light = (over: Partial<Light>): Light => ({
  id: 'l1',
  name: 'Sufit',
  roomId: 'r1',
  isOn: true,
  brightness: 70,
  capabilities: { dimming: true, colorTemperature: false, color: false },
  ...over,
});

describe('buildSnapshot', () => {
  it('denormalises rooms into what the widget renders', () => {
    const snapshot = buildSnapshot(true, [room({})], [light({}), light({ id: 'l2' })]);

    expect(snapshot).toEqual({
      connected: true,
      rooms: [{ id: 'r1', name: 'Salon', isOn: true, brightness: 70, lightCount: 2 }],
      lightsOn: 2,
      lightsTotal: 2,
    });
  });

  it('counts only the lights that are actually on', () => {
    const snapshot = buildSnapshot(true, [], [
      light({ id: 'a', isOn: true }),
      light({ id: 'b', isOn: false }),
      light({ id: 'c', isOn: false }),
    ]);

    expect(snapshot.lightsOn).toBe(1);
    expect(snapshot.lightsTotal).toBe(3);
  });

  it('reports a disconnected bridge so the widget can say so', () => {
    expect(buildSnapshot(false, [], [])).toEqual({
      connected: false,
      rooms: [],
      lightsOn: 0,
      lightsTotal: 0,
    });
  });
});
