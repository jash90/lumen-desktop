import { describe, expect, it } from 'vitest';

import { createHueApi } from '../src/main/hue/HueApi';
import { createHueClient } from '../src/main/hue/HueClient';
import { createFakeTransport, jsonResponse } from './fakeTransport';
import { CEILING_LIGHT, LIVING_ROOM, LIVING_ROOM_GROUP, PLAIN_LIGHT } from './fixtures';

function createApi(overrides: { lights?: unknown[]; rooms?: unknown[]; groups?: unknown[] } = {}) {
  const transport = createFakeTransport((options) => {
    if (options.path.endsWith('/light')) return jsonResponse(overrides.lights ?? [CEILING_LIGHT, PLAIN_LIGHT]);
    if (options.path.endsWith('/room')) return jsonResponse(overrides.rooms ?? [LIVING_ROOM]);
    if (options.path.endsWith('/grouped_light')) return jsonResponse(overrides.groups ?? [LIVING_ROOM_GROUP]);
    return jsonResponse([]);
  });
  return { transport, api: createHueApi(createHueClient(transport, 'key')) };
}

describe('HueApi', () => {
  it('assembles rooms and their lights from three separate resources', async () => {
    const { api } = createApi();
    await api.refresh();

    const rooms = api.getRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.name).toBe('Salon');
    expect(rooms[0]?.lightIds).toEqual(['light-ceiling', 'light-plain']);
  });

  it('drives a whole room through grouped_light, not one request per bulb', async () => {
    const { transport, api } = createApi();
    await api.refresh();
    transport.calls.length = 0;

    await api.setRoomPower('room-living', false);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.path).toBe('/clip/v2/resource/grouped_light/grouped-living');
  });

  it('falls back to per-light writes when the room has no group service', async () => {
    const { transport, api } = createApi({ rooms: [{ ...LIVING_ROOM, services: [] }] });
    await api.refresh();
    transport.calls.length = 0;

    await api.setRoomPower('room-living', false);

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls.every((call) => call.path.includes('/light/'))).toBe(true);
  });

  it('refuses a colour command on a bulb that cannot do colour', async () => {
    const { api } = createApi();
    await api.refresh();

    await expect(api.setLightColor('light-plain', { r: 255, g: 0, b: 0 })).rejects.toMatchObject({
      code: 'UnsupportedCapability',
    });
  });

  it('uses the bulb’s own mirek range when writing a temperature', async () => {
    const narrow = {
      ...CEILING_LIGHT,
      color_temperature: {
        mirek: 300,
        mirek_valid: true,
        mirek_schema: { mirek_minimum: 250, mirek_maximum: 454 },
      },
    };
    const { transport, api } = createApi({ lights: [narrow] });
    await api.refresh();
    transport.calls.length = 0;

    await api.setLightTemperature('light-ceiling', 100);

    expect(JSON.parse(transport.calls[0]?.body ?? '{}')).toEqual({
      color_temperature: { mirek: 250 },
    });
  });

  it('applies a partial event update without losing the bulb’s mirek range', async () => {
    const { api } = createApi();
    await api.refresh();

    // What the bridge actually pushes: only the changed leaf property.
    const changes = api.applyUpdates([
      { id: 'light-ceiling', type: 'light', dimming: { brightness: 10 } },
    ]);

    expect(changes.lights[0]?.brightness).toBe(10);
    // mirek_schema arrived only in the original GET; a shallow merge would have
    // dropped it and broken the temperature slider.
    expect(changes.lights[0]?.colorTemperature).toBe(39);
    expect(changes.rooms[0]?.id).toBe('room-living');
  });

  it('reports a room change when its grouped_light is updated externally', async () => {
    const { api } = createApi();
    await api.refresh();

    const changes = api.applyUpdates([
      { id: 'grouped-living', type: 'grouped_light', on: { on: false } },
    ]);

    expect(changes.rooms[0]?.isOn).toBe(false);
  });

  it('ignores updates for resources it does not track', async () => {
    const { api } = createApi();
    await api.refresh();

    const changes = api.applyUpdates([{ id: 'sensor-1', type: 'motion' }]);
    expect(changes).toEqual({ lights: [], rooms: [] });
  });
});
