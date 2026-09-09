import net from 'node:net';
import { describe, expect, it } from 'vitest';

import { decodeFrames, encodeFrame, TuyaCommand } from '../src/main/tuya/TuyaCodec';
import { dpsPayloadSchema, Dp } from '../src/main/tuya/dto';

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
