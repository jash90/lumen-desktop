import crypto from 'node:crypto';
import dgram from 'node:dgram';

import { announcementSchema } from './dto';
import { localNetworks } from './localNetworks';
import { decodeGcmFrames, encodeFrame35, NewCommand } from './TuyaProtocol';

/**
 * Finds Tuya devices by listening for the announcements they broadcast.
 *
 * Every few seconds a device shouts its id, address and protocol version onto
 * the local network: in the clear on port 6666 (protocol 3.1) and AES-encrypted
 * on 6667 (3.3 and 3.4) under a key that is the same on every Tuya device
 * ever made, so it protects nothing and is published in every implementation.
 *
 * 3.5 devices are quieter: they answer on port 7000, under AES-GCM with that
 * same key, when an app broadcasts a request for device info there. So this
 * sends one every few seconds while it listens.
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

const PORTS = [6666, 6667, 7000] as const;
const REQUEST_PORT = 7000;
const REQUEST_INTERVAL_MS = 4_000;
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

/** Announcements are plain JSON on 6666, AES-128-ECB on 6667 and AES-GCM on 7000. */
export function decodeAnnouncement(frame: Buffer): unknown | null {
  if (frame.length >= 4 && frame.readUInt32BE(0) === 0x00006699) {
    try {
      const [first] = decodeGcmFrames(frame, UDP_KEY, 'detect').frames;
      // The vendor app pads with NUL bytes now and then.
      return first ? JSON.parse(first.payload.toString('utf8').replace(/\0+$/, '')) : null;
    } catch {
      return null;
    }
  }
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

        // Asks 3.5 devices to speak up. Our own request echoes back on 7000 too;
        // it has no gwId, so the schema drops it like any other stray packet.
        const requester = dgram.createSocket('udp4');
        sockets.push(requester);
        requester.on('error', () => undefined);
        const request = (): void => {
          for (const network of localNetworks()) {
            const body = Buffer.from(JSON.stringify({ from: 'app', ip: network.address }));
            const frame = encodeFrame35(NewCommand.REQUEST_DEVICE_INFO, 0, body, UDP_KEY);
            try {
              requester.send(frame, REQUEST_PORT, network.broadcast, () => undefined);
            } catch {
              // Closed by finish() between ticks; nothing left to ask.
            }
          }
        };
        requester.bind(0, () => {
          try {
            requester.setBroadcast(true);
            requester.unref();
            request();
          } catch {
            /* no broadcast here; listening alone still finds 3.3 devices */
          }
        });
        const repeat = setInterval(request, REQUEST_INTERVAL_MS);
        repeat.unref();

        const timer = setTimeout(() => {
          clearInterval(repeat);
          finish();
        }, listenMs);
        timer.unref();
      });
    },
  };
}
