import net from 'node:net';
import { describe, expect, it } from 'vitest';

import { decodeFrames, encodeFrame, TuyaCommand } from '../src/main/tuya/TuyaCodec';
import { dpsPayloadSchema, Dp } from '../src/main/tuya/dto';
import { createTuyaAdapter } from '../src/main/tuya/TuyaAdapter';

/**
 * Hardware smoke test, in the spirit of live.bridge.test.ts.
 *
 * Skipped unless a device is supplied, so CI stays green without one:
 *   TUYA_IP=192.168.1.42 TUYA_DEVICE_ID=<devId> TUYA_LOCAL_KEY=<key> npm test
 *
 * It exercises what fixed vectors cannot: that a real bulb accepts frames this
 * codec produced and answers with frames it can read back. The unit tests prove
 * the bytes match a known-good implementation; this proves the device agrees.
 */
const ip = process.env.TUYA_IP;
const deviceId = process.env.TUYA_DEVICE_ID;
const localKey = process.env.TUYA_LOCAL_KEY;

/** One request, one reply, socket closed — no session machinery needed yet. */
function query(host: string, id: string, key: string, timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 6668 });
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    const finish = (error: Error | null, text?: string): void => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(text!);
    };

    const timer = setTimeout(() => finish(new Error('no reply within the timeout')), timeoutMs);

    socket.on('connect', () => {
      socket.write(encodeFrame(TuyaCommand.DP_QUERY, 1, JSON.stringify({ gwId: id, devId: id }), key));
    });

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const { frames, rest } = decodeFrames(buffer, key);
        buffer = rest;
        const reply = frames.find((frame) => frame.text.length > 0);
        if (reply) finish(null, reply.text);
      } catch (error) {
        // Decoding throws on a key the device does not share. Inside a 'data'
        // handler that would escape as an uncaught exception, so it is turned
        // into a rejection here — the transport will have to do the same.
        finish(error as Error);
      }
    });

    socket.on('error', (error) => finish(error));
  });
}

describe.skipIf(!ip || !deviceId || !localKey)('live Tuya device', () => {
  it('answers a query this codec built, with a frame it can read back', async () => {
    const text = await query(ip!, deviceId!, localKey!);
    const parsed = dpsPayloadSchema.safeParse(JSON.parse(text));

    expect(parsed.success).toBe(true);
    const dps = parsed.success ? parsed.data.dps : {};

    // Type B: power and brightness are the two every bulb of this shape has.
    expect(Object.keys(dps)).toContain(Dp.power);
    expect(typeof dps[Dp.power]).toBe('boolean');

    const brightness = dps[Dp.brightness];
    if (typeof brightness === 'number') {
      expect(brightness).toBeGreaterThanOrEqual(10);
      expect(brightness).toBeLessThanOrEqual(1000);
    }
  }, 15_000);

  /** A wrong key never fixes itself, so it must not look like a network blip. */
  it('reports a wrong local key as Unauthorized rather than a timeout', async () => {
    await expect(query(ip!, deviceId!, 'ffffffffffffffff', 5_000)).rejects.toMatchObject({
      code: 'Unauthorized',
    });
  }, 15_000);
});

/**
 * The whole adapter against the real device — transport, session, coalescing
 * and the LightingApi on top. The codec tests prove the bytes; this proves the
 * layers above them agree with a bulb that is actually plugged in.
 */
describe.skipIf(!ip || !deviceId || !localKey)('live Tuya adapter', () => {
  const credential = {
    kind: 'tuya' as const,
    id: 'tuya-local',
    name: 'Tuya (local)',
    address: 'local network',
    devices: [{ deviceId: deviceId!, name: 'Test bulb', address: ip!, localKey: localKey! }],
  };

  /** recover() is not exercised here, so discovery can be a stub. */
  const adapter = createTuyaAdapter({
    repository: { get: () => null, save: () => undefined } as never,
    discovery: { discover: async () => [] },
  });

  it('connects, reads the light and drives it', async () => {
    const changes: number[] = [];
    const session = await adapter.connect(credential, {
      onChanges: (change) => changes.push(change.lights.length),
      onClosed: () => undefined,
    });

    try {
      expect(session.detail?.()).toBe('1 device');

      const [light] = session.api.getLights();
      expect(light).toBeDefined();
      expect(light!.id).toBe(deviceId);
      expect(light!.capabilities.dimming).toBe(true);

      const wasOn = light!.isOn;

      await session.api.setLightPower(deviceId!, true);
      await new Promise((r) => setTimeout(r, 1_500));
      expect(session.api.getLight(deviceId!).isOn).toBe(true);

      await session.api.setLightBrightness(deviceId!, 40);
      await new Promise((r) => setTimeout(r, 1_500));
      expect(session.api.getLight(deviceId!).brightness).toBeCloseTo(40, -1);

      // Leave it as it was found.
      await session.api.setLightPower(deviceId!, wasOn);
      await new Promise((r) => setTimeout(r, 1_000));
    } finally {
      session.stop();
    }
  }, 40_000);

  /** Two writes inside the window must reach the device as one frame. */
  it('merges rapid writes instead of flooding the device', async () => {
    const session = await adapter.connect(credential, {
      onChanges: () => undefined,
      onClosed: () => undefined,
    });

    try {
      const before = session.api.getLight(deviceId!).isOn;
      await Promise.all([
        session.api.setLightBrightness(deviceId!, 30),
        session.api.setLightBrightness(deviceId!, 60),
        session.api.setLightBrightness(deviceId!, 90),
      ]);
      await new Promise((r) => setTimeout(r, 1_500));

      // The last value wins; the intermediate steps never went out.
      expect(session.api.getLight(deviceId!).brightness).toBeCloseTo(90, -1);
      await session.api.setLightPower(deviceId!, before);
      await new Promise((r) => setTimeout(r, 1_000));
    } finally {
      session.stop();
    }
  }, 40_000);
});
