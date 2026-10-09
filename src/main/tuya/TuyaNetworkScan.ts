import net from 'node:net';

import { TUYA_VERSIONS, type TuyaVersion } from './TuyaProtocol';
import { openTuyaTransport, TUYA_PORT } from './TuyaTransport';

/**
 * Finds devices by address rather than by broadcast.
 *
 * For the ones discovery cannot hear: a device that happens to stay quiet, a
 * network that drops broadcasts between Wi-Fi clients, a VLAN in the way. Two
 * passes:
 *
 *   1. which addresses accept a connection on 6668 — on a home network that is
 *      almost always a Tuya device and nothing else;
 *   2. for each of those, which known key it answers to. A device will not say
 *      who it is to someone without its key, so the keys are the question.
 *
 * Without any key the scan can still say where the devices are, which is
 * enough to tell the user that something is there.
 */

export interface ScanCandidate {
  deviceId: string;
  localKey: string;
}

export interface ScanHit {
  deviceId: string;
  address: string;
  version: TuyaVersion;
}

export interface ScanResult {
  /** Devices identified by their key. */
  hits: ScanHit[];
  /** Addresses that look like a Tuya device but answered to none of the keys. */
  unidentified: string[];
}

export interface ScanDependencies {
  isOpen(address: string): Promise<boolean>;
  answers(address: string, candidate: ScanCandidate, version: TuyaVersion): Promise<boolean>;
}

const PORT_CONCURRENCY = 64;
const IDENTIFY_CONCURRENCY = 4;
const PORT_TIMEOUT_MS = 800;
const IDENTIFY_TIMEOUT_MS = 2_000;

/** Newest first: a 3.3 device answers fast either way, a newer one only to its own. */
const VERSION_ORDER: readonly TuyaVersion[] = [...TUYA_VERSIONS].reverse();

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function scanAddresses(
  addresses: readonly string[],
  candidates: readonly ScanCandidate[],
  deps: ScanDependencies,
): Promise<ScanResult> {
  const unique = [...new Set(addresses)];
  const open = (
    await mapLimited(unique, PORT_CONCURRENCY, async (address) =>
      (await deps.isOpen(address)) ? address : null,
    )
  ).filter((address): address is string => address !== null);

  const remaining = new Map(candidates.map((candidate) => [candidate.deviceId, candidate]));
  const hits: ScanHit[] = [];
  const unidentified: string[] = [];

  await mapLimited(open, IDENTIFY_CONCURRENCY, async (address) => {
    for (const candidate of [...remaining.values()]) {
      // Another address may have claimed it while this one was busy.
      if (!remaining.has(candidate.deviceId)) continue;
      for (const version of VERSION_ORDER) {
        if (await deps.answers(address, candidate, version)) {
          remaining.delete(candidate.deviceId);
          hits.push({ deviceId: candidate.deviceId, address, version });
          return;
        }
      }
    }
    unidentified.push(address);
  });

  return { hits, unidentified: unidentified.sort() };
}

/** The real thing: TCP to 6668, and a full query through the transport. */
export const networkScanDependencies: ScanDependencies = {
  isOpen: (address) =>
    new Promise((resolve) => {
      const socket = net.createConnection({ host: address, port: TUYA_PORT });
      const done = (open: boolean): void => {
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(PORT_TIMEOUT_MS, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    }),

  async answers(address, candidate, version) {
    try {
      const transport = await openTuyaTransport({
        deviceId: candidate.deviceId,
        address,
        localKey: candidate.localKey,
        version,
        timeoutMs: IDENTIFY_TIMEOUT_MS,
        onPush: () => undefined,
        onClosed: () => undefined,
      });
      try {
        await transport.query();
        return true;
      } finally {
        transport.close();
      }
    } catch {
      return false;
    }
  },
};
