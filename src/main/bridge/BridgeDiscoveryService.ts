import https from 'node:https';
import { Bonjour } from 'bonjour-service';

import { HueError } from '../../shared/errors';
import type { DiscoveredBridge } from '../../shared/models';
import { bridgeConfigSchema, cloudDiscoverySchema, type BridgeConfigDto } from '../hue/dto';
import { createHueTransport } from '../hue/HueTransport';
import type { BridgeRepository } from './BridgeRepository';

/**
 * Finding the bridge (PRD §21, §63.1).
 *
 * Four strategies, because no single one is reliable: mDNS is blocked by VPNs,
 * some Wi-Fi APs and any routed/multi-subnet setup; the cloud endpoint needs
 * internet and only sees bridges sharing your public IP; a remembered address
 * breaks on DHCP renewal. Manual entry is the guaranteed fallback.
 */

const MDNS_TIMEOUT_MS = 2_500;
const CLOUD_TIMEOUT_MS = 6_000;
/** discovery.meethue.com rate-limits callers, so its answer is reused rather than re-fetched. */
const CLOUD_CACHE_TTL_MS = 15 * 60 * 1_000;

export interface BridgeProbe {
  bridgeId: string;
  config: BridgeConfigDto;
}

/**
 * Confirms an address really is a Hue Bridge and learns its id.
 *
 * The TLS chain is verified against the bundled Hue root CA before the id is
 * read, and the certificate's Common Name is then checked against the id the
 * bridge reports — so a device cannot claim to be a bridge it is not.
 */
export async function probeBridge(ip: string): Promise<BridgeProbe> {
  const transport = createHueTransport(ip, null);
  try {
    const { status, body } = await transport.request({
      method: 'GET',
      path: '/api/config',
      timeoutMs: 5_000,
    });
    if (status !== 200) throw new HueError('BridgeNotFound', `HTTP ${status} from ${ip}`);

    const config = bridgeConfigSchema.safeParse(JSON.parse(body));
    if (!config.success) throw new HueError('BridgeNotFound', `${ip} is not a Hue Bridge`);

    const bridgeId = config.data.bridgeid.toLowerCase();
    if (transport.peerBridgeId && transport.peerBridgeId !== bridgeId) {
      throw new HueError(
        'CertificateError',
        `certificate is for ${transport.peerBridgeId} but bridge reports ${bridgeId}`,
      );
    }
    return { bridgeId, config: config.data };
  } finally {
    transport.destroy();
  }
}

function discoverViaMdns(): Promise<DiscoveredBridge[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredBridge>();
    let bonjour: Bonjour;
    try {
      bonjour = new Bonjour();
    } catch {
      resolve([]);
      return;
    }

    const browser = bonjour.find({ type: 'hue', protocol: 'tcp' }, (service) => {
      const bridgeId = String(
        (service.txt as Record<string, string> | undefined)?.bridgeid ?? '',
      ).toLowerCase();
      const ip = service.addresses?.find((address) => address.includes('.'));
      if (bridgeId && ip) {
        found.set(bridgeId, { id: bridgeId, ip, name: service.name, source: 'mdns' });
      }
    });

    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve([...found.values()]);
    }, MDNS_TIMEOUT_MS);
  });
}

let cloudCache: { at: number; bridges: DiscoveredBridge[] } | null = null;

function discoverViaCloud(): Promise<DiscoveredBridge[]> {
  if (cloudCache && Date.now() - cloudCache.at < CLOUD_CACHE_TTL_MS) {
    return Promise.resolve(cloudCache.bridges);
  }

  return new Promise((resolve) => {
    const request = https.get(
      'https://discovery.meethue.com',
      { timeout: CLOUD_TIMEOUT_MS },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = cloudDiscoverySchema.parse(JSON.parse(body));
            const bridges = parsed.map<DiscoveredBridge>((entry) => ({
              id: entry.id.toLowerCase(),
              ip: entry.internalipaddress,
              source: 'cloud',
            }));
            cloudCache = { at: Date.now(), bridges };
            resolve(bridges);
          } catch {
            resolve([]);
          }
        });
      },
    );
    // Discovery is best-effort: no internet simply means this strategy contributes nothing.
    request.on('error', () => resolve([]));
    request.on('timeout', () => {
      request.destroy();
      resolve([]);
    });
  });
}

export interface BridgeDiscoveryService {
  discover(): Promise<DiscoveredBridge[]>;
  /** Verifies a hand-typed address and returns it as a discovery result. */
  addManual(ip: string): Promise<DiscoveredBridge>;
  /** Locates a known bridge that may have changed address (PRD §51). */
  findKnownBridge(bridgeId: string): Promise<string | null>;
}

export function createBridgeDiscoveryService(
  repository: BridgeRepository,
): BridgeDiscoveryService {
  async function collect(): Promise<DiscoveredBridge[]> {
    const byId = new Map<string, DiscoveredBridge>();

    // Ordered by trust: a locally observed address beats a cloud-reported one,
    // which beats a possibly stale remembered one.
    for (const bridge of repository.list()) {
      byId.set(bridge.bridgeId, {
        id: bridge.bridgeId,
        ip: bridge.bridgeIp,
        name: bridge.name,
        source: 'cache',
      });
    }
    for (const bridge of await discoverViaCloud()) byId.set(bridge.id, bridge);
    for (const bridge of await discoverViaMdns()) byId.set(bridge.id, bridge);

    return [...byId.values()];
  }

  return {
    discover: collect,

    async addManual(ip) {
      const { bridgeId, config } = await probeBridge(ip);
      return { id: bridgeId, ip, name: config.name, source: 'manual' };
    },

    async findKnownBridge(bridgeId) {
      const candidates = await collect();
      const match = candidates.find((bridge) => bridge.id === bridgeId.toLowerCase());
      if (!match) return null;
      // Confirm the address actually answers before handing it to the caller.
      try {
        const probe = await probeBridge(match.ip);
        return probe.bridgeId === bridgeId.toLowerCase() ? match.ip : null;
      } catch {
        return null;
      }
    },
  };
}
