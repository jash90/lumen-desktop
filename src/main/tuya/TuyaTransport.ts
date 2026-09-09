import net from 'node:net';

import { AppError } from '../../shared/errors';
import {
  decodeFrames,
  encodeFrame,
  TuyaCommand,
  type TuyaCommandCode,
} from './TuyaCodec';

/**
 * One TCP socket to one Tuya device.
 *
 * The counterpart of `HueTransport`, but for a raw socket rather than HTTPS,
 * which brings three obligations the HTTP adapters never had to think about:
 *
 *   - **Heartbeat.** The device closes an idle connection without warning, so
 *     something has to keep saying hello.
 *   - **`onClosed` exactly once.** `net.Socket` reports one drop twice —
 *     `'error'` then `'close'`. The connection layer guards against a second
 *     call, but the contract in ProviderHooks asks adapters not to rely on that.
 *   - **Nothing may throw out of a `'data'` handler.** Decoding throws on a key
 *     the device does not share; inside an event handler that escapes as an
 *     uncaught exception and takes the process with it.
 *
 * Requests are serialised — one in flight at a time — rather than correlated by
 * sequence number. At the rate a light is actually operated that costs nothing,
 * and it removes a whole class of matching bugs.
 */

const PORT = 6668;
const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

export interface TuyaTransport {
  readonly deviceId: string;
  readonly address: string;
  /** Resolves with the decoded reply body, or '' when the device sends none. */
  request(command: TuyaCommandCode, payload: unknown): Promise<string>;
  close(): void;
}

export interface TuyaTransportOptions {
  deviceId: string;
  address: string;
  localKey: string;
  /** An unsolicited status frame — something else changed the device. */
  onPush(text: string): void;
  onClosed(error?: Error): void;
}

interface Pending {
  command: TuyaCommandCode;
  resolve(text: string): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export function openTuyaTransport(options: TuyaTransportOptions): Promise<TuyaTransport> {
  const { deviceId, address, localKey, onPush, onClosed } = options;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port: PORT });
    socket.setNoDelay(true);

    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let seq = 1;
    let pending: Pending | null = null;
    let queue: Promise<unknown> = Promise.resolve();
    let closeReported = false;
    let heartbeat: NodeJS.Timeout | null = null;
    let opened = false;

    const reportClosed = (error?: Error): void => {
      if (closeReported) return;
      closeReported = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(error ?? new AppError('BridgeOffline', 'the device closed the connection'));
        pending = null;
      }
      // Only after the connection was handed over; before that the promise
      // rejection below is the whole story.
      if (opened) onClosed(error);
    };

    const connectTimer = setTimeout(() => {
      socket.destroy();
      reject(new AppError('BridgeOffline', `timed out connecting to ${address}`));
    }, CONNECT_TIMEOUT_MS);
    connectTimer.unref();

    socket.on('connect', () => {
      clearTimeout(connectTimer);

      heartbeat = setInterval(() => {
        // Failure here is not fatal on its own: the socket's own close event is
        // what decides the connection is gone.
        void transport.request(TuyaCommand.HEART_BEAT, {}).catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MS);
      // Without this the interval alone keeps the Electron process alive on quit.
      heartbeat.unref();

      opened = true;
      resolve(transport);
    });

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      let frames;
      try {
        const decoded = decodeFrames(buffer, localKey);
        frames = decoded.frames;
        buffer = decoded.rest;
      } catch (error) {
        // A wrong local key lands here. It must not escape the handler, and the
        // connection has to end — retrying a key that cannot work is pointless.
        socket.destroy();
        reportClosed(error as Error);
        if (!opened) reject(error as Error);
        return;
      }

      for (const frame of frames) {
        if (pending && frame.command === pending.command) {
          clearTimeout(pending.timer);
          pending.resolve(frame.text);
          pending = null;
          continue;
        }
        // Anything unmatched is the device telling us something changed.
        if (frame.text.length > 0) onPush(frame.text);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(connectTimer);
      socket.destroy();
      reportClosed(error);
      if (!opened) reject(new AppError('BridgeOffline', error.message, { cause: error }));
    });

    socket.on('close', () => {
      clearTimeout(connectTimer);
      reportClosed();
      if (!opened) reject(new AppError('BridgeOffline', `${address} closed the connection`));
    });

    const send = (command: TuyaCommandCode, payload: unknown): Promise<string> =>
      new Promise<string>((resolveRequest, rejectRequest) => {
        if (socket.destroyed) {
          rejectRequest(new AppError('BridgeOffline', 'the connection is gone'));
          return;
        }

        const timer = setTimeout(() => {
          pending = null;
          rejectRequest(new AppError('BridgeOffline', `${deviceId} did not answer`));
        }, REQUEST_TIMEOUT_MS);
        timer.unref();

        pending = { command, resolve: resolveRequest, reject: rejectRequest, timer };
        socket.write(encodeFrame(command, seq++, JSON.stringify(payload), localKey));
      });

    const transport: TuyaTransport = {
      deviceId,
      address,

      request(command, payload) {
        // One at a time: the device answers in order and this keeps replies
        // attached to the right request without trusting the sequence number.
        const run = queue.then(
          () => send(command, payload),
          () => send(command, payload),
        );
        queue = run.catch(() => undefined);
        return run;
      },

      close() {
        // Deliberately no onClosed: the caller asked for this and knows.
        closeReported = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new AppError('BridgeOffline', 'connection closed'));
          pending = null;
        }
        socket.destroy();
      },
    };
  });
}
