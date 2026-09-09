import crypto from 'node:crypto';
import dgram from 'node:dgram';

import { announcementSchema } from './dto';

/**
 * Finds Tuya devices by listening for the announcements they broadcast.
 *
 * Every few seconds a device shouts its id, address and protocol version onto
 * the local network: in the clear on port 6666 (protocol 3.1) and AES-encrypted
 * on 6667 (3.3 and later) under a key that is the same on every Tuya device
 * ever made, so it protects nothing and is published in every implementation.
 *
 * Two things learned the hard way on this network:
 *
 *   - **A single pass is not enough.** The first scan here found two devices
 *     and missed the bulb entirely, because it simply had not spoken in that
 *     window. The default listen is therefore long, and manual entry stays
 *     available for anything that still does not appear.
 *   - **Not every device that answers is yours.** A neighbouring Tuya device on
 *     the same network broadcasts too, and there is no local key for it. The
 *     caller decides what it recognises.
 */

const PORTS = [6666, 6667] as const;
const DEFAULT_LISTEN_MS = 12_000;

/** Published in every Tuya implementation; it is a format detail, not a secret. */
const UDP_KEY = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();

const PREFIX = 0x000055aa;
const HEADER_BYTES = 20;
const TRAILER_BYTES = 8;

export interface DiscoveredTuyaDevice {
  deviceId: string;
  address: string;
  version: string;
  productKey?: string;
}

export interface TuyaDiscoveryService {
  discover(listenMs?: number): Promise<DiscoveredTuyaDevice[]>;
}

/** Announcements are plain JSON on 6666 and AES-128-ECB on 6667. */
export function decodeAnnouncement(frame: Buffer): unknown | null {
  if (frame.length < HEADER_BYTES + TRAILER_BYTES) return null;
  if (frame.readUInt32BE(0) !== PREFIX) return null;

  const body = frame.subarray(HEADER_BYTES, frame.length - TRAILER_BYTES);
  const text = body.toString('utf8');
  if (text.trimStart().startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', UDP_KEY, null);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
  } catch {
    // A malformed or foreign packet is not an error; it is simply not for us.
    return null;
  }
}

export function createTuyaDiscoveryService(): TuyaDiscoveryService {
  return {
    discover(listenMs = DEFAULT_LISTEN_MS) {
      return new Promise<DiscoveredTuyaDevice[]>((resolve) => {
        const found = new Map<string, DiscoveredTuyaDevice>();
        const sockets: dgram.Socket[] = [];

        const finish = (): void => {
          for (const socket of sockets) {
            try {
              socket.close();
            } catch {
              /* already closed */
            }
          }
          resolve([...found.values()]);
        };

        for (const port of PORTS) {
          const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          sockets.push(socket);

          socket.on('message', (message) => {
            const parsed = announcementSchema.safeParse(decodeAnnouncement(message));
            if (!parsed.success) return;
            const { gwId, ip, version, productKey } = parsed.data;
            found.set(gwId, {
              deviceId: gwId,
              address: ip,
              version: version ?? '3.3',
              ...(productKey ? { productKey } : {}),
            });
          });

          // Best-effort, exactly like the mDNS pass on the Hue side: a port we
          // cannot bind means one fewer source, never a failed discovery.
          socket.on('error', () => {
            try {
              socket.close();
            } catch {
              /* already closed */
            }
          });

          try {
            socket.bind(port);
            socket.unref();
          } catch {
            /* nothing to listen on here */
          }
        }

        const timer = setTimeout(finish, listenMs);
        timer.unref();
      });
    },
  };
}
