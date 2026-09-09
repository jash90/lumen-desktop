import { describe, expect, it } from 'vitest';

import { createHaAdapter } from '../src/main/homeassistant/HaAdapter';

/**
 * Hardware smoke test against a real Home Assistant, in the spirit of
 * live.bridge.test.ts.
 *
 * Skipped unless both are supplied, so CI stays green without an instance:
 *   HA_BASE_URL=http://homeassistant.local:8123 HA_TOKEN=<long-lived> npm test
 *
 * It exercises what cannot be faked convincingly: the real WebSocket handshake,
 * the area registry, and whether the entities on an actual install map onto the
 * domain model.
 */
const baseUrl = process.env.HA_BASE_URL;
const token = process.env.HA_TOKEN;

describe.skipIf(!baseUrl || !token)('live Home Assistant', () => {
  const credential = {
    kind: 'homeassistant' as const,
    id: 'live-ha',
    name: 'Live',
    address: baseUrl!,
    token: token!,
  };

  it('authenticates, reads the registry and maps the lights', async () => {
    const session = await createHaAdapter().connect(credential, {
      onChanges: () => undefined,
      onClosed: () => undefined,
    });

    try {
      const lights = session.api.getLights();
      expect(lights.length).toBeGreaterThan(0);

      // Whatever the integration behind them, they have to arrive as the domain
      // model — a percentage, not a 0-255 level.
      for (const light of lights) {
        expect(light.id.startsWith('light.')).toBe(true);
        expect(light.brightness).toBeGreaterThanOrEqual(0);
        expect(light.brightness).toBeLessThanOrEqual(100);
      }

      for (const room of session.api.getRooms()) {
        expect(room.lightIds.length).toBeGreaterThan(0);
      }
    } finally {
      session.stop();
    }
  }, 30_000);

  it('reports a bad token as Unauthorized rather than as a network problem', async () => {
    await expect(
      createHaAdapter().connect(
        { ...credential, token: 'not-a-real-token' },
        { onChanges: () => undefined, onClosed: () => undefined },
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  }, 30_000);
});
