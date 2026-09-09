import { describe, expect, it, vi } from 'vitest';

import type { Light, Room } from '../src/shared/models';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const { buildSnapshot, toCredentials } = await import('../src/main/widget/WidgetBridge');

const room = (over: Partial<Room>): Room => ({
  id: 'r1',
  providerId: 'bridge-1',
  name: 'Living Room',
  lightIds: ['l1', 'l2'],
  isOn: true,
  brightness: 70,
  supportsGroupControl: true,
  ...over,
});

const light = (over: Partial<Light>): Light => ({
  id: 'l1',
  providerId: 'bridge-1',
  name: 'Ceiling',
  roomId: 'r1',
  isOn: true,
  brightness: 70,
  capabilities: { dimming: true, colorTemperature: false, color: false },
  ...over,
});

describe('buildSnapshot', () => {
  it('denormalises rooms into what the widget renders', () => {
    const snapshot = buildSnapshot(
      true,
      [room({})],
      [light({}), light({ id: 'l2' })],
      new Set(['bridge-1']),
    );

    expect(snapshot).toEqual({
      connected: true,
      rooms: [
        {
          id: 'r1',
          providerId: 'bridge-1',
          name: 'Living Room',
          isOn: true,
          brightness: 70,
          lightCount: 2,
          controllable: true,
        },
      ],
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

  /**
   * A hub whose credential was not exported still shows — as a reading rather
   * than a switch. A button that silently does nothing would be worse.
   */
  it('marks a room read-only when its hub was not exported', () => {
    const snapshot = buildSnapshot(true, [room({ providerId: 'ha-1' })], [], new Set(['bridge-1']));

    expect(snapshot.rooms[0]?.controllable).toBe(false);
  });

  it('reports a disconnected hub so the widget can say so', () => {
    expect(buildSnapshot(false, [], [])).toEqual({
      connected: false,
      rooms: [],
      lightsOn: 0,
      lightsTotal: 0,
    });
  });
});

const hueCredential = {
  kind: 'hue' as const,
  id: '001788fffe1234ab',
  address: '192.168.1.42',
  name: 'Hue Bridge',
  applicationKey: 'secret-key',
  modelId: 'BSB002',
  swVersion: '1978074000',
};

const haCredential = {
  kind: 'homeassistant' as const,
  id: 'ha:ha.local:8123',
  address: 'http://ha.local:8123',
  name: 'Home Assistant',
  token: 'long-lived-token',
};

describe('toCredentials', () => {
  it('exports only what the widget needs to reach the bridge', () => {
    expect(toCredentials([hueCredential], false)).toEqual([
      {
        kind: 'hue',
        providerId: '001788fffe1234ab',
        address: '192.168.1.42',
        applicationKey: 'secret-key',
      },
    ]);
  });

  /**
   * A Home Assistant token grants that whole API — locks, cameras, alarms — and
   * works remotely if the instance is exposed. Nothing like the Hue key, so it
   * leaves the Keychain only when the user has said so.
   */
  it('withholds the Home Assistant token until it is explicitly allowed', () => {
    expect(toCredentials([hueCredential, haCredential], false)).toHaveLength(1);

    const opted = toCredentials([hueCredential, haCredential], true);
    expect(opted).toHaveLength(2);
    expect(opted[1]).toMatchObject({ kind: 'homeassistant', token: 'long-lived-token' });
  });
});
