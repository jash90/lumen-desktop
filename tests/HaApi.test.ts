import { describe, expect, it, vi } from 'vitest';

import { createHaApi } from '../src/main/homeassistant/HaApi';
import type { HaClient, ServiceTarget } from '../src/main/homeassistant/HaClient';
import { entityStateSchema } from '../src/main/homeassistant/dto';
import {
  HA_COLOR_LIGHT,
  HA_KITCHEN_AREA,
  HA_ONOFF_LIGHT,
  HA_SCENE,
  HA_TEMPERATURE_LIGHT,
} from './fixtures';

/**
 * The API over a fake client — the same shape as the Hue tests, which run over
 * a fake transport. What is under test is the caching, the routing of writes
 * onto Home Assistant services, and folding pushed state back in.
 */

interface Call {
  domain: string;
  service: string;
  target: ServiceTarget;
  data?: Record<string, unknown>;
}

function createFakeClient() {
  const calls: Call[] = [];
  const client: HaClient = {
    ping: vi.fn(async () => undefined),
    getStates: async () =>
      [HA_COLOR_LIGHT, HA_TEMPERATURE_LIGHT, HA_ONOFF_LIGHT, HA_SCENE, {
        entity_id: 'automation.wake_up',
        state: 'on',
        attributes: { friendly_name: 'Wake up' },
      }, {
        // Not a lighting entity: it must never reach the domain model.
        entity_id: 'sensor.temperature',
        state: '21.5',
        attributes: { friendly_name: 'Temperature' },
      }].map((raw) => entityStateSchema.parse(raw)),
    callService: async (domain, service, target, data) => {
      calls.push({ domain, service, target, data });
    },
  };
  return { client, calls };
}

async function createApi() {
  const { client, calls } = createFakeClient();
  const api = createHaApi({
    client,
    providerId: 'ha-1',
    areas: [HA_KITCHEN_AREA, { area_id: 'empty', name: 'Cellar' }],
    areaByEntity: new Map([
      ['light.kitchen_ceiling', 'kitchen'],
      ['light.hallway', 'kitchen'],
    ]),
  });
  await api.refresh();
  calls.length = 0;
  return { api, calls };
}

describe('HaApi reads', () => {
  it('keeps only the entities this app controls', async () => {
    const { api } = await createApi();

    expect(api.getLights().map((light) => light.id).sort()).toEqual([
      'light.desk',
      'light.hallway',
      'light.kitchen_ceiling',
    ]);
    expect(api.getScenes().map((scene) => scene.id)).toEqual(['scene.movie_night']);
    expect(api.getAutomations().map((entry) => entry.id)).toEqual(['automation.wake_up']);
  });

  /** Areas also cover rooms holding nothing but a thermostat. */
  it('hides an area with no light in it', async () => {
    const { api } = await createApi();

    expect(api.getRooms().map((room) => room.id)).toEqual(['kitchen']);
    expect(api.getRoom('kitchen').lightIds).toEqual([
      'light.kitchen_ceiling',
      'light.hallway',
    ]);
  });

  it('refuses a light or a room it has never heard of', async () => {
    const { api } = await createApi();

    expect(() => api.getLight('light.nope')).toThrowError(/unknown light/);
    expect(() => api.getRoom('attic')).toThrowError(/unknown room/);
  });
});

describe('HaApi writes', () => {
  it('switches a light through the light domain', async () => {
    const { api, calls } = await createApi();
    await api.setLightPower('light.kitchen_ceiling', false);

    expect(calls).toEqual([
      { domain: 'light', service: 'turn_off', target: { entity_id: 'light.kitchen_ceiling' }, data: undefined },
    ]);
  });

  it('sends brightness in the 0-255 Home Assistant expects', async () => {
    const { api, calls } = await createApi();
    await api.setLightBrightness('light.kitchen_ceiling', 50);

    expect(calls[0]?.data).toEqual({ brightness: 128 });
  });

  /** 0 % is off, not a brightness of zero, which some integrations reject. */
  it('turns a light off rather than sending a zero level', async () => {
    const { api, calls } = await createApi();
    await api.setLightBrightness('light.kitchen_ceiling', 0);

    expect(calls[0]?.service).toBe('turn_off');
    expect(calls[0]?.data).toBeUndefined();
  });

  it('converts the temperature into the range that light reports', async () => {
    const { api, calls } = await createApi();
    await api.setLightTemperature('light.kitchen_ceiling', 0);

    // The warm end of its own 2000–6500 K range, not a fixed default.
    expect(calls[0]?.data).toEqual({ color_temp_kelvin: 2000 });
  });

  /** One request for the area beats one per bulb — HA fans out itself. */
  it('drives a room by targeting the area', async () => {
    const { api, calls } = await createApi();
    await api.setRoomPower('kitchen', true);

    expect(calls).toEqual([
      { domain: 'light', service: 'turn_on', target: { area_id: 'kitchen' }, data: undefined },
    ]);
  });

  it('toggles an automation through the automation domain', async () => {
    const { api, calls } = await createApi();
    await api.setAutomationEnabled('automation.wake_up', false);

    expect(calls[0]).toMatchObject({ domain: 'automation', service: 'turn_off' });
  });

  it('applies a scene through scene.turn_on', async () => {
    const { api, calls } = await createApi();
    await api.activateScene('scene.movie_night');

    expect(calls[0]).toMatchObject({ domain: 'scene', service: 'turn_on' });
  });
});

describe('HaApi applyUpdates', () => {
  it('folds a pushed state into the cache and reports the room too', async () => {
    const { api } = await createApi();

    const changes = api.applyUpdates([
      {
        entity_id: 'light.kitchen_ceiling',
        state: 'off',
        attributes: { ...HA_COLOR_LIGHT.attributes, brightness: null },
      },
    ]);

    expect(changes.lights).toHaveLength(1);
    expect(changes.lights[0]).toMatchObject({ id: 'light.kitchen_ceiling', isOn: false });
    expect(changes.rooms.map((room) => room.id)).toEqual(['kitchen']);
    // The cached read reflects it without another round trip.
    expect(api.getLight('light.kitchen_ceiling').isOn).toBe(false);
  });

  it('ignores an update for something outside the lighting domains', async () => {
    const { api } = await createApi();

    const changes = api.applyUpdates([
      { entity_id: 'sensor.temperature', state: '22.0', attributes: {} },
    ]);

    expect(changes).toEqual({ lights: [], rooms: [] });
  });

  /** The socket is remote input: a frame we cannot read must not throw. */
  it('skips a malformed frame instead of failing the batch', async () => {
    const { api } = await createApi();

    const changes = api.applyUpdates([
      { nonsense: true },
      null,
      { entity_id: 'light.hallway', state: 'off', attributes: {} },
    ]);

    expect(changes.lights.map((light) => light.id)).toEqual(['light.hallway']);
  });
});
