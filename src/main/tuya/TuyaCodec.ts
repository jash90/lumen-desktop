import crypto from 'node:crypto';

import { AppError } from '../../shared/errors';

/**
 * The Tuya LAN wire format, protocol 3.3 (PRD-equivalent for this provider).
 *
 * A frame is:
 *
 *   000055aa | seq(4) | command(4) | length(4) | [retcode(4)] | payload | crc32(4) | 0000aa55
 *
 * where `length` counts the payload, the CRC and the suffix — everything after
 * itself. The payload is AES-128-ECB, PKCS7-padded, keyed on the device's own
 * 16-character local key.
 *
 * ECB is not a choice we get to make: protocol 3.3 specifies it, and a device
 * will not answer anything else. It is a genuinely weak mode — identical
 * plaintext blocks produce identical ciphertext — but the alternative is not
 * talking to the hardware at all. Tuya addressed this in 3.4 (session keys,
 * HMAC) and 3.5 (GCM); both are different protocols rather than options here,
 * and neither device on this network speaks them.
 *
 * Deliberately pure and stateless, like `parseSseChunk` on the Hue side: no
 * socket, no timers, no device. That is what lets the whole thing be tested
 * against fixed vectors rather than against a bulb that has to be plugged in.
 */

export const TuyaCommand = {
  CONTROL: 0x07,
  /** Unsolicited state, pushed when something else changes the device. */
  STATUS: 0x08,
  HEART_BEAT: 0x09,
  DP_QUERY: 0x0a,
  UPDATE_DPS: 0x12,
} as const;

export type TuyaCommandCode = (typeof TuyaCommand)[keyof typeof TuyaCommand];

const PREFIX = 0x000055aa;
const SUFFIX = 0x0000aa55;
/** prefix + seq + command + length */
const HEADER_BYTES = 16;
/** crc32 + suffix */
const TRAILER_BYTES = 8;
const AES_BLOCK = 16;

/**
 * `"3.3"` followed by twelve zero bytes, prepended in the clear ahead of the
 * ciphertext — but only for CONTROL. Sending it on a DP_QUERY, a heartbeat or
 * an UPDATEDPS makes the device answer nothing at all, with no error, which is
 * the single most common way a hand-rolled Tuya client ends up silently dead.
 */
const VERSION_HEADER = Buffer.concat([Buffer.from('3.3', 'ascii'), Buffer.alloc(12)]);

const NEEDS_VERSION_HEADER: ReadonlySet<number> = new Set([TuyaCommand.CONTROL]);

export interface DecodedFrame {
  seq: number;
  command: number;
  /** Present on replies and pushes; requests carry none. */
  retcode?: number;
  /** Decrypted payload. Empty when the device answered with no body. */
  text: string;
}

const cipherKey = (localKey: string): Buffer => {
  const key = Buffer.from(localKey, 'utf8');
  if (key.length !== AES_BLOCK) {
    throw new AppError('Unauthorized', `local key must be 16 characters, got ${key.length}`);
  }
  return key;
};

export function encryptPayload(plaintext: string, localKey: string): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', cipherKey(localKey), null);
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
}

export function decryptPayload(ciphertext: Buffer, localKey: string): string {
  if (ciphertext.length === 0) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', cipherKey(localKey), null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    // A wrong key looks exactly like this. Reporting it as Unauthorized is what
    // stops the connection layer retrying a key that will never work.
    throw new AppError('Unauthorized', 'could not decrypt the device response', { cause: error });
  }
}

export function encodeFrame(
  command: TuyaCommandCode,
  seq: number,
  plaintext: string,
  localKey: string,
): Buffer {
  const encrypted = encryptPayload(plaintext, localKey);
  const payload = NEEDS_VERSION_HEADER.has(command)
    ? Buffer.concat([VERSION_HEADER, encrypted])
    : encrypted;

  const head = Buffer.alloc(HEADER_BYTES);
  head.writeUInt32BE(PREFIX, 0);
  head.writeUInt32BE(seq, 4);
  head.writeUInt32BE(command, 8);
  head.writeUInt32BE(payload.length + TRAILER_BYTES, 12);

  const trailer = Buffer.alloc(TRAILER_BYTES);
  trailer.writeUInt32BE(crc32(Buffer.concat([head, payload])), 0);
  trailer.writeUInt32BE(SUFFIX, 4);

  return Buffer.concat([head, payload, trailer]);
}

const startsWithVersionHeader = (buffer: Buffer, at: number): boolean =>
  buffer.length >= at + VERSION_HEADER.length &&
  buffer.subarray(at, at + 3).toString('ascii') === '3.3';

/**
 * Splits the payload region into its optional return code and its ciphertext.
 *
 * Four shapes occur in the wild — with or without a return code, each with or
 * without the version header — so this decides by looking rather than by
 * assuming the direction of travel.
 */
function splitBody(region: Buffer): { retcode?: number; ciphertext: Buffer } {
  if (startsWithVersionHeader(region, 0)) {
    return { ciphertext: region.subarray(VERSION_HEADER.length) };
  }
  if (startsWithVersionHeader(region, 4)) {
    return {
      retcode: region.readUInt32BE(0),
      ciphertext: region.subarray(4 + VERSION_HEADER.length),
    };
  }
  // Ciphertext is always a whole number of AES blocks, so a remainder means the
  // first four bytes are a return code rather than part of it.
  if (region.length % AES_BLOCK === 0) return { ciphertext: region };
  if (region.length >= 4) {
    return { retcode: region.readUInt32BE(0), ciphertext: region.subarray(4) };
  }
  return { ciphertext: region };
}

/**
 * Reads whatever whole frames the buffer holds, returning the remainder.
 *
 * TCP splits wherever it likes, so a read can carry half a frame, three frames,
 * or a frame plus a fragment — the caller keeps `rest` and prepends it next
 * time. Mirrors `parseSseChunk` in the Hue event stream.
 *
 * **Throws** when a frame will not decrypt, which is what a wrong local key
 * looks like. That has to reach the connection layer as `Unauthorized` so it
 * stops retrying a key that can never work — but it also means a caller reading
 * from a socket must wrap this in try/catch. An exception thrown inside a
 * `'data'` handler does not reject anything; it escapes as an uncaught
 * exception and takes the process with it.
 */
export function decodeFrames(
  buffer: Buffer,
  localKey: string,
): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = [];
  let offset = 0;

  while (buffer.length - offset >= HEADER_BYTES) {
    if (buffer.readUInt32BE(offset) !== PREFIX) {
      // Resynchronise: a byte that cannot start a frame is dropped rather than
      // stalling the stream on a corrupt read.
      offset += 1;
      continue;
    }

    const length = buffer.readUInt32BE(offset + 12);
    const total = HEADER_BYTES + length;
    if (buffer.length - offset < total) break;

    const frame = buffer.subarray(offset, offset + total);
    const region = frame.subarray(HEADER_BYTES, total - TRAILER_BYTES);
    const expected = frame.readUInt32BE(total - TRAILER_BYTES);

    if (crc32(frame.subarray(0, total - TRAILER_BYTES)) === expected) {
      const { retcode, ciphertext } = splitBody(region);
      frames.push({
        seq: frame.readUInt32BE(4),
        command: frame.readUInt32BE(8),
        ...(retcode === undefined ? {} : { retcode }),
        text: decryptPayload(ciphertext, localKey),
      });
    } else {
      console.warn('[tuya] dropping a frame whose checksum does not match');
    }

    offset += total;
  }

  return { frames, rest: buffer.subarray(offset) };
}

/** Standard CRC-32, table built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
