import crypto from 'node:crypto';

import { AppError } from '../../shared/errors';
import { decodeFrames, encodeFrame, TuyaCommand } from './TuyaCodec';

/**
 * Protocols 3.4 and 3.5, and the one interface the transport uses for all three.
 *
 * TuyaCodec stays the 3.3 wire format it always was. The newer two differ in
 * more than the cipher, which is why they are separate encoders here rather
 * than options on that one:
 *
 *   - **3.4** keeps the 55aa frame and AES-ECB, but swaps the CRC for an
 *     HMAC-SHA256 trailer, encrypts the version header *with* the payload, and
 *     runs everything under a session key negotiated per connection.
 *   - **3.5** moves to a 6699 frame and AES-128-GCM, with the header bytes as
 *     authenticated data, and negotiates its session key the same way.
 *
 * Both also renamed the commands: a 3.4 device ignores CONTROL and DP_QUERY and
 * only answers CONTROL_NEW and DP_QUERY_NEW, with a differently shaped body.
 *
 * Like TuyaCodec this file is pure — no socket, no timers — so every byte is
 * tested against vectors produced by an independent implementation.
 */

export const TUYA_VERSIONS = ['3.3', '3.4', '3.5'] as const;
export type TuyaVersion = (typeof TUYA_VERSIONS)[number];

/**
 * What a device announces, narrowed to what this app speaks. 3.1 and 3.2 are
 * treated as 3.3, which is what the app always did with them.
 */
export function normaliseVersion(raw: string | undefined): TuyaVersion {
  return raw === '3.4' || raw === '3.5' ? raw : '3.3';
}

export const SessionCommand = {
  NEGOTIATE_START: 0x03,
  NEGOTIATE_RESPONSE: 0x04,
  NEGOTIATE_FINISH: 0x05,
} as const;

export const NewCommand = {
  CONTROL_NEW: 0x0d,
  DP_QUERY_NEW: 0x10,
  /** Broadcast to UDP 7000 to make 3.5 devices announce themselves. */
  REQUEST_DEVICE_INFO: 0x25,
} as const;

/** Commands that never carry the "3.x" + twelve zero bytes header. */
const HEADERLESS: ReadonlySet<number> = new Set([
  TuyaCommand.DP_QUERY,
  TuyaCommand.HEART_BEAT,
  TuyaCommand.UPDATE_DPS,
  NewCommand.DP_QUERY_NEW,
  SessionCommand.NEGOTIATE_START,
  SessionCommand.NEGOTIATE_RESPONSE,
  SessionCommand.NEGOTIATE_FINISH,
  0x40,
]);

const versionHeader = (version: TuyaVersion): Buffer =>
  Buffer.concat([Buffer.from(version, 'ascii'), Buffer.alloc(12)]);

const withHeader = (version: TuyaVersion, command: number, payload: Buffer): Buffer =>
  HEADERLESS.has(command) ? payload : Buffer.concat([versionHeader(version), payload]);

/** Replies may or may not repeat the header; it carries nothing worth keeping. */
const stripHeader = (version: TuyaVersion, payload: Buffer): Buffer =>
  payload.length >= 15 && payload.subarray(0, 3).toString('ascii') === version
    ? payload.subarray(15)
    : payload;

export interface RawFrame {
  seq: number;
  command: number;
  retcode?: number;
  /** Decrypted, version header removed. */
  payload: Buffer;
}

export interface DecodeResult {
  frames: RawFrame[];
  rest: Buffer;
}

export function keyBytes(localKey: string): Buffer {
  const key = Buffer.from(localKey, 'utf8');
  if (key.length !== 16) {
    throw new AppError('Unauthorized', `local key must be 16 characters, got ${key.length}`);
  }
  return key;
}

const wrongKey = (cause?: unknown): AppError =>
  new AppError('Unauthorized', 'the device does not share this key', { cause });

function ecbEncrypt(plain: Buffer, key: Buffer, pad = true): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(pad);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

function ecbDecrypt(data: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const uint32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
};

const hmac = (key: Buffer, data: Buffer): Buffer =>
  crypto.createHmac('sha256', key).update(data).digest();

// ---------------------------------------------------------------------------
// 3.4: 55aa frame, AES-ECB, HMAC-SHA256 trailer
//
//   000055aa | seq(4) | command(4) | length(4) | [retcode(4)] | ciphertext | hmac(32) | 0000aa55

const PREFIX_55AA = 0x000055aa;
const SUFFIX_55AA = 0x0000aa55;
const HEAD_55AA = 16;
const TRAIL_HMAC = 36;

/** `retcode` is what a device puts ahead of its replies; a client sends none. */
export function encodeFrame34(
  command: number,
  seq: number,
  payload: Buffer,
  key: Buffer,
  retcode?: number,
): Buffer {
  const ciphertext = ecbEncrypt(withHeader('3.4', command, payload), key);
  const encrypted =
    retcode === undefined ? ciphertext : Buffer.concat([uint32(retcode), ciphertext]);

  const head = Buffer.alloc(HEAD_55AA);
  head.writeUInt32BE(PREFIX_55AA, 0);
  head.writeUInt32BE(seq, 4);
  head.writeUInt32BE(command, 8);
  head.writeUInt32BE(encrypted.length + TRAIL_HMAC, 12);

  const suffix = Buffer.alloc(4);
  suffix.writeUInt32BE(SUFFIX_55AA, 0);

  const signed = Buffer.concat([head, encrypted]);
  return Buffer.concat([signed, hmac(key, signed), suffix]);
}

/** Throws Unauthorized on a frame signed under another key — see decodeFrames. */
export function decodeFrames34(buffer: Buffer, key: Buffer): DecodeResult {
  const frames: RawFrame[] = [];
  let offset = 0;

  while (buffer.length - offset >= HEAD_55AA) {
    if (buffer.readUInt32BE(offset) !== PREFIX_55AA) {
      offset += 1;
      continue;
    }
    const total = HEAD_55AA + buffer.readUInt32BE(offset + 12);
    if (buffer.length - offset < total) break;

    const frame = buffer.subarray(offset, offset + total);
    offset += total;
    if (total < HEAD_55AA + TRAIL_HMAC) continue;

    const signed = frame.subarray(0, total - TRAIL_HMAC);
    const mac = frame.subarray(total - TRAIL_HMAC, total - 4);
    if (!hmac(key, signed).equals(mac)) throw wrongKey();

    // Ciphertext is whole AES blocks, so four spare bytes are the return code.
    let region = frame.subarray(HEAD_55AA, total - TRAIL_HMAC);
    let retcode: number | undefined;
    if (region.length % 16 === 4) {
      retcode = region.readUInt32BE(0);
      region = region.subarray(4);
    }

    let plain: Buffer;
    try {
      plain = region.length === 0 ? Buffer.alloc(0) : ecbDecrypt(region, key);
    } catch (error) {
      throw wrongKey(error);
    }

    frames.push({
      seq: frame.readUInt32BE(4),
      command: frame.readUInt32BE(8),
      ...(retcode === undefined ? {} : { retcode }),
      payload: stripHeader('3.4', plain),
    });
  }

  return { frames, rest: buffer.subarray(offset) };
}

// ---------------------------------------------------------------------------
// 3.5: 6699 frame, AES-128-GCM, header bytes 4–18 authenticated
//
//   00006699 | 0000 | seq(4) | command(4) | length(4) | iv(12) | ciphertext | tag(16) | 00009966
//
// where `length` covers iv, ciphertext and tag but not the suffix.

const PREFIX_6699 = 0x00006699;
const SUFFIX_6699 = 0x00009966;
const HEAD_6699 = 18;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encodeFrame35(
  command: number,
  seq: number,
  payload: Buffer,
  key: Buffer,
  // A fresh nonce per frame; GCM falls apart if one is ever reused under a key.
  iv: Buffer = crypto.randomBytes(IV_BYTES),
  retcode?: number,
): Buffer {
  const framed = withHeader('3.5', command, payload);
  const body = retcode === undefined ? framed : Buffer.concat([uint32(retcode), framed]);

  const head = Buffer.alloc(HEAD_6699);
  head.writeUInt32BE(PREFIX_6699, 0);
  head.writeUInt16BE(0, 4);
  head.writeUInt32BE(seq, 6);
  head.writeUInt32BE(command, 10);
  head.writeUInt32BE(IV_BYTES + body.length + TAG_BYTES, 14);

  const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
  cipher.setAAD(head.subarray(4));
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);

  const suffix = Buffer.alloc(4);
  suffix.writeUInt32BE(SUFFIX_6699, 0);

  return Buffer.concat([head, iv, encrypted, cipher.getAuthTag(), suffix]);
}

/**
 * `retcode`: a device always puts four return-code bytes ahead of its TCP
 * replies, while a UDP announcement may or may not — there it is guessed.
 */
export function decodeGcmFrames(
  buffer: Buffer,
  key: Buffer,
  retcode: 'always' | 'detect',
): DecodeResult {
  const frames: RawFrame[] = [];
  let offset = 0;

  while (buffer.length - offset >= HEAD_6699) {
    if (buffer.readUInt32BE(offset) !== PREFIX_6699) {
      offset += 1;
      continue;
    }
    const length = buffer.readUInt32BE(offset + 14);
    const total = HEAD_6699 + length + 4;
    if (buffer.length - offset < total) break;

    const frame = buffer.subarray(offset, offset + total);
    offset += total;
    if (length < IV_BYTES + TAG_BYTES) continue;

    const iv = frame.subarray(HEAD_6699, HEAD_6699 + IV_BYTES);
    const encrypted = frame.subarray(HEAD_6699 + IV_BYTES, HEAD_6699 + length - TAG_BYTES);
    const tag = frame.subarray(HEAD_6699 + length - TAG_BYTES, HEAD_6699 + length);

    let plain: Buffer;
    try {
      const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
      decipher.setAAD(frame.subarray(4, HEAD_6699));
      decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (error) {
      throw wrongKey(error);
    }

    let code: number | undefined;
    const hasCode =
      retcode === 'always'
        ? plain.length >= 4
        : plain.length > 4 && plain[0] !== 0x7b && plain[4] === 0x7b;
    if (hasCode) {
      code = plain.readUInt32BE(0);
      plain = plain.subarray(4);
    }

    frames.push({
      seq: frame.readUInt32BE(6),
      command: frame.readUInt32BE(10),
      ...(code === undefined ? {} : { retcode: code }),
      payload: stripHeader('3.5', plain),
    });
  }

  return { frames, rest: buffer.subarray(offset) };
}

export const decodeFrames35 = (buffer: Buffer, key: Buffer): DecodeResult =>
  decodeGcmFrames(buffer, key, 'always');

// ---------------------------------------------------------------------------
// Session key negotiation (3.4 and 3.5)
//
//   client → NEGOTIATE_START    local nonce (16 random bytes)
//   device → NEGOTIATE_RESPONSE remote nonce (16) + HMAC(local key, local nonce) (32)
//   client → NEGOTIATE_FINISH   HMAC(local key, remote nonce)
//
// All three are framed under the device's real local key; everything after
// under the session key derived from both nonces. The HMAC in the response is
// what proves the device holds the same key — a wrong key fails right here.

/** Returns the device's nonce, or throws Unauthorized when its proof does not match. */
export function readNegotiationResponse(
  payload: Buffer,
  localKey: Buffer,
  localNonce: Buffer,
): Buffer {
  if (payload.length < 48) throw wrongKey();
  const remoteNonce = payload.subarray(0, 16);
  if (!hmac(localKey, localNonce).equals(payload.subarray(16, 48))) throw wrongKey();
  return Buffer.from(remoteNonce);
}

export const negotiationFinishPayload = (localKey: Buffer, remoteNonce: Buffer): Buffer =>
  hmac(localKey, remoteNonce);

export function deriveSessionKey(
  version: '3.4' | '3.5',
  localKey: Buffer,
  localNonce: Buffer,
  remoteNonce: Buffer,
): Buffer {
  const mixed = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 1) {
    mixed[index] = localNonce[index]! ^ remoteNonce[index]!;
  }
  if (version === '3.4') return ecbEncrypt(mixed, localKey, false);

  const cipher = crypto.createCipheriv('aes-128-gcm', localKey, localNonce.subarray(0, IV_BYTES));
  return Buffer.concat([cipher.update(mixed), cipher.final()]);
}

// ---------------------------------------------------------------------------
// One interface over all three

export interface FrameCodec {
  readonly version: TuyaVersion;
  encode(command: number, payload: Buffer): Buffer;
  /** Throws Unauthorized when a frame was not made with the current key. */
  decode(buffer: Buffer): DecodeResult;
  /** Switches to the negotiated session key. Not used by 3.3. */
  useSessionKey(key: Buffer): void;
}

export function createFrameCodec(version: TuyaVersion, localKey: string): FrameCodec {
  let key = keyBytes(localKey);
  let seq = 1;

  if (version === '3.3') {
    return {
      version,
      encode: (command, payload) =>
        encodeFrame(command, seq++, payload.toString('utf8'), localKey),
      decode(buffer) {
        const { frames, rest } = decodeFrames(buffer, localKey);
        return {
          frames: frames.map(({ text, ...frame }) => ({ ...frame, payload: Buffer.from(text) })),
          rest,
        };
      },
      useSessionKey() {
        /* 3.3 has no session */
      },
    };
  }

  const encodeWith = version === '3.4' ? encodeFrame34 : encodeFrame35;
  const decodeWith = version === '3.4' ? decodeFrames34 : decodeFrames35;
  return {
    version,
    encode: (command, payload) => encodeWith(command, seq++, payload, key),
    decode: (buffer) => decodeWith(buffer, key),
    useSessionKey(next) {
      key = next;
    },
  };
}

/** The commands and body shapes each version expects. */
export interface CommandSet {
  query: { command: number; body: unknown };
  heartbeat: { command: number; body: unknown };
  control(dps: Record<string, unknown>): { command: number; body: unknown };
}

export function commandsFor(version: TuyaVersion, deviceId: string): CommandSet {
  if (version === '3.3') {
    return {
      query: { command: TuyaCommand.DP_QUERY, body: { gwId: deviceId, devId: deviceId } },
      heartbeat: { command: TuyaCommand.HEART_BEAT, body: {} },
      control: (dps) => ({
        command: TuyaCommand.CONTROL,
        body: {
          devId: deviceId,
          uid: deviceId,
          t: Math.floor(Date.now() / 1000).toString(),
          dps,
        },
      }),
    };
  }
  return {
    query: { command: NewCommand.DP_QUERY_NEW, body: {} },
    heartbeat: { command: TuyaCommand.HEART_BEAT, body: { gwId: deviceId, devId: deviceId } },
    control: (dps) => ({
      command: NewCommand.CONTROL_NEW,
      body: { protocol: 5, t: Math.floor(Date.now() / 1000), data: { dps } },
    }),
  };
}
