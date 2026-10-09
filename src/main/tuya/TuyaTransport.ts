import crypto from 'node:crypto';
import net from 'node:net';

import { AppError } from '../../shared/errors';
import { normaliseDpsText } from './dto';
import { TuyaCommand } from './TuyaCodec';
import {
  commandsFor,
  createFrameCodec,
  deriveSessionKey,
  keyBytes,
  negotiationFinishPayload,
  readNegotiationResponse,
  SessionCommand,
  type RawFrame,
  type TuyaVersion,
} from './TuyaProtocol';

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
 * and it removes a whole class of matching bugs. (A 3.5 device would not echo
 * the sequence number anyway; it answers with a counter of its own.)
 *
 * From 3.4 on, the socket first negotiates a session key. The device's answer
 * includes an HMAC over our nonce, so a wrong local key fails at that step as
 * Unauthorized — the same signal a 3.3 device gives by sending something that
 * will not decrypt.
 */

export const TUYA_PORT = 6668;
const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

export interface TuyaTransport {
  readonly deviceId: string;
  readonly address: string;
  readonly version: TuyaVersion;
  /** Current data points as JSON with `dps` at the top, whatever the version. */
  query(): Promise<string>;
  /** Resolves once the device has acknowledged the write. */
  control(dps: Record<string, unknown>): Promise<void>;
  close(): void;
}

export interface TuyaTransportOptions {
  deviceId: string;
  address: string;
  localKey: string;
  /** Defaults to 3.3: devices stored before versions were recorded all speak it. */
  version?: TuyaVersion;
  /** Shorter when probing an address that may not be the device at all. */
  timeoutMs?: number;
  /** Always 6668 on a real device; tests point it at a fake one. */
  port?: number;
  /** An unsolicited status frame — something else changed the device. */
  onPush(text: string): void;
  onClosed(error?: Error): void;
}

interface Pending {
  accepts(frame: RawFrame, text: string): boolean;
  resolve(frame: RawFrame): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

const hasDps = (text: string): boolean => text.includes('"dps"');

export function openTuyaTransport(options: TuyaTransportOptions): Promise<TuyaTransport> {
  const { deviceId, address, localKey, onPush, onClosed } = options;
  const version = options.version ?? '3.3';
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const commands = commandsFor(version, deviceId);

  return new Promise((resolve, reject) => {
    // Validated before the socket opens: a key of the wrong length is the
    // user's typo, not a network problem.
    let codec: ReturnType<typeof createFrameCodec>;
    try {
      codec = createFrameCodec(version, localKey);
    } catch (error) {
      reject(error as Error);
      return;
    }

    const socket = net.createConnection({ host: address, port: options.port ?? TUYA_PORT });
    socket.setNoDelay(true);

    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let pending: Pending | null = null;
    let queue: Promise<unknown> = Promise.resolve();
    let closeReported = false;
    let heartbeat: NodeJS.Timeout | null = null;
    let opened = false;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

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
      // rejection is the whole story.
      if (opened) onClosed(error);
    };

    const connectTimer = setTimeout(() => {
      socket.destroy();
      fail(new AppError('BridgeOffline', `timed out connecting to ${address}`));
    }, Math.min(CONNECT_TIMEOUT_MS, timeoutMs));
    connectTimer.unref();

    const send = (
      command: number,
      payload: Buffer,
      accepts: Pending['accepts'] | null,
    ): Promise<RawFrame | null> =>
      new Promise((resolveRequest, rejectRequest) => {
        if (socket.destroyed) {
          rejectRequest(new AppError('BridgeOffline', 'the connection is gone'));
          return;
        }
        const frame = codec.encode(command, payload);
        if (!accepts) {
          socket.write(frame);
          resolveRequest(null);
          return;
        }
        const timer = setTimeout(() => {
          pending = null;
          rejectRequest(new AppError('BridgeOffline', `${deviceId} did not answer`));
        }, timeoutMs);
        timer.unref();
        pending = { accepts, resolve: resolveRequest, reject: rejectRequest, timer };
        socket.write(frame);
      });

    /** One at a time: replies stay attached to the right request. */
    const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
      const run = queue.then(work, work);
      queue = run.catch(() => undefined);
      return run;
    };

    const json = (body: unknown): Buffer => Buffer.from(JSON.stringify(body), 'utf8');

    async function negotiate(): Promise<void> {
      if (version === '3.3') return;
      const realKey = keyBytes(localKey);
      const localNonce = crypto.randomBytes(16);
      const response = await send(
        SessionCommand.NEGOTIATE_START,
        localNonce,
        (frame) => frame.command === SessionCommand.NEGOTIATE_RESPONSE,
      );
      const remoteNonce = readNegotiationResponse(response!.payload, realKey, localNonce);
      await send(
        SessionCommand.NEGOTIATE_FINISH,
        negotiationFinishPayload(realKey, remoteNonce),
        null,
      );
      codec.useSessionKey(deriveSessionKey(version, realKey, localNonce, remoteNonce));
    }

    socket.on('connect', () => {
      clearTimeout(connectTimer);
      negotiate().then(
        () => {
          heartbeat = setInterval(() => {
            // Failure here is not fatal on its own: the socket's own close
            // event is what decides the connection is gone.
            void enqueue(() =>
              send(commands.heartbeat.command, json(commands.heartbeat.body), (frame) =>
                frame.command === TuyaCommand.HEART_BEAT,
              ),
            ).catch(() => undefined);
          }, HEARTBEAT_INTERVAL_MS);
          // Without this the interval alone keeps the Electron process alive on quit.
          heartbeat.unref();

          opened = true;
          settled = true;
          resolve(transport);
        },
        (error: Error) => {
          socket.destroy();
          fail(error);
        },
      );
    });

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      let frames: RawFrame[];
      try {
        const decoded = codec.decode(buffer);
        frames = decoded.frames;
        buffer = decoded.rest;
      } catch (error) {
        // A wrong local key lands here. It must not escape the handler, and the
        // connection has to end — retrying a key that cannot work is pointless.
        socket.destroy();
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(error as Error);
          pending = null;
        }
        reportClosed(error as Error);
        fail(error as Error);
        return;
      }

      for (const frame of frames) {
        const text = normaliseDpsText(frame.payload.toString('utf8'));
        if (pending && pending.accepts(frame, text)) {
          clearTimeout(pending.timer);
          // Raw: the negotiation reply is binary and would not survive a
          // round trip through a string.
          pending.resolve(frame);
          pending = null;
          continue;
        }
        // Anything unmatched is the device telling us something changed.
        if (hasDps(text)) onPush(text);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(connectTimer);
      socket.destroy();
      reportClosed(error);
      fail(new AppError('BridgeOffline', error.message, { cause: error }));
    });

    socket.on('close', () => {
      clearTimeout(connectTimer);
      reportClosed();
      fail(new AppError('BridgeOffline', `${address} closed the connection`));
    });

    const transport: TuyaTransport = {
      deviceId,
      address,
      version,

      query: () =>
        enqueue(async () => {
          // Some devices acknowledge the query empty and send the state as a
          // separate status frame, so whichever carries data points answers it.
          const frame = await send(
            commands.query.command,
            json(commands.query.body),
            (reply, text) =>
              (reply.command === commands.query.command ||
                reply.command === TuyaCommand.STATUS) &&
              hasDps(text),
          );
          return normaliseDpsText(frame!.payload.toString('utf8'));
        }),

      control: (dps) =>
        enqueue(async () => {
          const { command, body } = commands.control(dps);
          await send(command, json(body), (reply) => reply.command === command);
        }),

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
