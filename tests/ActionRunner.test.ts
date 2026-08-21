import { describe, expect, it } from 'vitest';

import { createActionRunner } from '../src/main/actions/ActionRunner';
import type { ConnectionManager } from '../src/main/bridge/ConnectionManager';
import { createHueApi, type HueApi } from '../src/main/hue/HueApi';
import { createHueClient } from '../src/main/hue/HueClient';
import { createFakeTransport, jsonResponse } from './fakeTransport';
import {
  CEILING_LIGHT,
  LIVING_ROOM,
  LIVING_ROOM_GROUP,
  PLAIN_LIGHT,
  RELAX_SCENE,
  ZONE_SCENE,
} from './fixtures';

/** A light belonging to no room — it has no group to be switched through. */
const LOOSE_LIGHT = {
  id: 'light-loose',
  owner: { rid: 'device-loose', rtype: 'device' },
  metadata: { name: 'Lampa w korytarzu' },
  on: { on: true },
  dimming: { brightness: 50 },
  type: 'light',
};

async function createRunner(lights: unknown[] = [CEILING_LIGHT, PLAIN_LIGHT]) {
  const transport = createFakeTransport((options) => {
    if (options.path.endsWith('/light')) return jsonResponse(lights);
    if (options.path.endsWith('/room')) return jsonResponse([LIVING_ROOM]);
    if (options.path.endsWith('/grouped_light')) return jsonResponse([LIVING_ROOM_GROUP]);
    if (options.path.endsWith('/scene')) return jsonResponse([RELAX_SCENE, ZONE_SCENE]);
    return jsonResponse([]);
  });

  const api: HueApi = createHueApi(createHueClient(transport, 'key'));
  await api.refresh();
  transport.calls.length = 0;

  // The runner only ever reaches for requireApi(); the rest of the manager is
  // irrelevant here.
  const connection = { requireApi: () => api } as unknown as ConnectionManager;
  return { transport, runner: createActionRunner(connection) };
}

describe('ActionRunner', () => {
  it('inverts whatever the room is currently doing', async () => {
    const { transport, runner } = await createRunner();

    // LIVING_ROOM_GROUP reports the room as on, so a toggle must switch it off.
    await runner.run({ kind: 'toggleRoom', id: 'room-living' });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.path).toBe('/clip/v2/resource/grouped_light/grouped-living');
    expect(JSON.parse(transport.calls[0]?.body ?? '{}')).toEqual({ on: { on: false } });
  });

  it('inverts a single light the same way', async () => {
    const { transport, runner } = await createRunner();

    // PLAIN_LIGHT is off, so this turns it on.
    await runner.run({ kind: 'toggleLight', id: 'light-plain' });

    expect(JSON.parse(transport.calls[0]?.body ?? '{}')).toEqual({ on: { on: true } });
  });

  it('switches everything off through room groups, not bulb by bulb', async () => {
    const { transport, runner } = await createRunner();

    await runner.run({ kind: 'allOff' });

    // One grouped_light write covers both bulbs in the room.
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.path).toContain('/grouped_light/');
  });

  it('still reaches lights that belong to no room', async () => {
    const { transport, runner } = await createRunner([CEILING_LIGHT, PLAIN_LIGHT, LOOSE_LIGHT]);

    await runner.run({ kind: 'allOff' });

    const paths = transport.calls.map((call) => call.path);
    expect(paths).toContain('/clip/v2/resource/grouped_light/grouped-living');
    // Without this the corridor lamp would stay on after "everything off".
    expect(paths).toContain('/clip/v2/resource/light/light-loose');
  });

  it('recalls a scene through the scene resource', async () => {
    const { transport, runner } = await createRunner();

    await runner.run({ kind: 'activateScene', id: 'scene-relax' });

    expect(transport.calls[0]?.path).toBe('/clip/v2/resource/scene/scene-relax');
  });
});
