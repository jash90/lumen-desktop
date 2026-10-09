import crypto from 'node:crypto';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { TuyaCommand } from '../src/main/tuya/TuyaCodec';
import {
  decodeFrames34,
  decodeGcmFrames,
  deriveSessionKey,
  encodeFrame34,
  encodeFrame35,
  NewCommand,
  SessionCommand,
  type DecodeResult,
} from '../src/main/tuya/TuyaProtocol';
import { openTuyaTransport } from '../src/main/tuya/TuyaTransport';

/**
 * The transport against a fake 3.4 / 3.5 device on a loopback socket.
 *
 * The fake is built from the same encoders the protocol tests pin against an
 * independent implementation, so what this proves is the conversation: that
 * the session is negotiated in the right order, that the key switches at the
 * right moment, and that replies and pushes reach the right place.
 */

const KEY = '0123456789abcdef';
const REMOTE_NONCE = Buffer.from('remote-nonce-16b');

const hmac = (key: Buffer, data: Buffer): Buffer =>
  crypto.createHmac('sha256', key).update(data).digest();

interface FakeDevice {
  port: number;
  writes: unknown[];
  close(): void;
}

function startFakeDevice(version: '3.4' | '3.5', key = KEY): Promise<FakeDevice> {
  const realKey = Buffer.from(key);
  const writes: unknown[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let current: Buffer = realKey;
    let localNonce = Buffer.alloc(16);
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let seq = 100;

    const reply = (command: number, payload: Buffer): void => {
      socket.write(
        version === '3.4'
          ? encodeFrame34(command, seq++, payload, current, 0)
          : encodeFrame35(command, seq++, payload, current, undefined, 0),
      );
    };

    /**
     * One frame at a time, because the key changes between them: the frame
     * that finishes the negotiation and the first one under the session key
     * can arrive in the same read.
     */
    const decode = (data: Buffer): DecodeResult => {
      const length =
        version === '3.4' ? 16 + data.readUInt32BE(12) : 18 + data.readUInt32BE(14) + 4;
      if (data.length < length) return { frames: [], rest: data };
      const one = data.subarray(0, length);
      const { frames } =
        version === '3.4'
          ? decodeFrames34(one, current)
          : // A client sends no return code; the binary nonce is never mistaken for one.
            decodeGcmFrames(one, current, 'detect');
      return { frames, rest: data.subarray(length) };
    };

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 18) {
        if (!handleOne()) return;
      }
    });

    /** False when the buffer holds no whole frame yet. */
    const handleOne = (): boolean => {
      let decoded: DecodeResult;
      try {
        decoded = decode(buffer);
      } catch {
        // Signed under another key. Answer the negotiation anyway, as a device
        // does, so the client's own proof check is what fails.
        buffer = Buffer.alloc(0);
        reply(
          SessionCommand.NEGOTIATE_RESPONSE,
          Buffer.concat([REMOTE_NONCE, hmac(realKey, Buffer.alloc(16))]),
        );
        return false;
      }
      if (decoded.frames.length === 0) return false;
      buffer = decoded.rest;

      for (const frame of decoded.frames) {
        switch (frame.command) {
          case SessionCommand.NEGOTIATE_START:
            localNonce = Buffer.from(frame.payload);
            reply(
              SessionCommand.NEGOTIATE_RESPONSE,
              Buffer.concat([REMOTE_NONCE, hmac(realKey, localNonce)]),
            );
            break;
          case SessionCommand.NEGOTIATE_FINISH:
            expect(frame.payload).toEqual(hmac(realKey, REMOTE_NONCE));
            current = deriveSessionKey(version, realKey, localNonce, REMOTE_NONCE);
            break;
          case NewCommand.DP_QUERY_NEW:
            // Acknowledged empty, with the state following as a status frame —
            // the shape the transport has to be patient with.
            reply(NewCommand.DP_QUERY_NEW, Buffer.alloc(0));
            reply(
              TuyaCommand.STATUS,
              Buffer.from('{"protocol":4,"t":1,"data":{"dps":{"20":true,"22":500}}}'),
            );
            break;
          case NewCommand.CONTROL_NEW: {
            const body = JSON.parse(frame.payload.toString()) as { data: { dps: unknown } };
            writes.push(body.data.dps);
            reply(NewCommand.CONTROL_NEW, Buffer.alloc(0));
            reply(
              TuyaCommand.STATUS,
              Buffer.from(JSON.stringify({ protocol: 4, t: 2, data: { dps: body.data.dps } })),
            );
            break;
          }
          default:
            break;
        }
      }
      return true;
    };
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        writes,
        close() {
          sockets.forEach((socket) => socket.destroy());
          server.close();
        },
      });
    });
  });
}

let device: FakeDevice | null = null;
afterEach(() => {
  device?.close();
  device = null;
});

describe.each(['3.4', '3.5'] as const)('openTuyaTransport on %s', (version) => {
  it('negotiates a session, reads the state and writes to it', async () => {
    device = await startFakeDevice(version);
    const pushes: string[] = [];

    const transport = await openTuyaTransport({
      deviceId: 'dev1',
      address: '127.0.0.1',
      port: device.port,
      localKey: KEY,
      version,
      onPush: (text) => pushes.push(text),
      onClosed: () => undefined,
    });

    // Lifted out of `data`, so the adapter sees the 3.3 shape it already reads.
    expect(JSON.parse(await transport.query())).toMatchObject({
      dps: { '20': true, '22': 500 },
    });

    await transport.control({ '20': false });
    expect(device.writes).toEqual([{ '20': false }]);

    await expect.poll(() => pushes.length).toBe(1);
    expect(JSON.parse(pushes[0]!)).toMatchObject({ dps: { '20': false } });

    transport.close();
  });

  it('rejects a key the device does not share as Unauthorized', async () => {
    device = await startFakeDevice(version);

    await expect(
      openTuyaTransport({
        deviceId: 'dev1',
        address: '127.0.0.1',
        port: device.port,
        localKey: 'wrongwrongwrong!',
        version,
        timeoutMs: 2_000,
        onPush: () => undefined,
        onClosed: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  });
});
