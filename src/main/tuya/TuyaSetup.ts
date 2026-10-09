import { AppError } from '../../shared/errors';
import type { TuyaCloudDeviceSummary } from '../../shared/ipc';
import { parseTarget } from '../../shared/ipRange';
import {
  fetchCloudDevices,
  isLightCategory,
  type CloudDevice,
  type TuyaCloudCredentials,
} from './TuyaCloud';
import { localNetworks } from './localNetworks';
import { scanAddresses, type ScanCandidate, type ScanDependencies } from './TuyaNetworkScan';
import type { TuyaVersion } from './TuyaProtocol';

/**
 * What the "Add a hub → Tuya" form talks to while it is open.
 *
 * Holds the keys fetched from the Tuya Cloud in memory for the session, so they
 * never have to travel to the renderer and back: the form gets names and
 * categories, and asks for a device by id. Nothing here is persisted — only the
 * devices the user actually connects end up in the stored credential.
 */

type CloudDeviceSummary = TuyaCloudDeviceSummary;

export interface ScanFound {
  deviceId: string;
  address: string;
  version: TuyaVersion;
}

export interface TuyaSetupService {
  fetchCloud(credentials: TuyaCloudCredentials): Promise<CloudDeviceSummary[]>;
  /** The key the cloud returned for a device, if it did. */
  cloudKey(deviceId: string): string | undefined;
  cloudName(deviceId: string): string | undefined;
  scan(input: {
    target?: string;
    keys: ScanCandidate[];
  }): Promise<{ found: ScanFound[]; unidentified: string[] }>;
}

type Fetch = Parameters<typeof fetchCloudDevices>[1];

export function createTuyaSetup(deps: { fetch: Fetch; scan: ScanDependencies }): TuyaSetupService {
  let cloud = new Map<string, CloudDevice>();

  return {
    async fetchCloud(credentials) {
      const devices = await fetchCloudDevices(credentials, deps.fetch);
      cloud = new Map(devices.map((device) => [device.deviceId, device]));
      return devices.map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        productName: device.productName,
        isLight: isLightCategory(device.category),
      }));
    },

    cloudKey: (deviceId) => cloud.get(deviceId)?.localKey,
    cloudName: (deviceId) => cloud.get(deviceId)?.name,

    async scan({ target, keys }) {
      let addresses: string[];
      if (target && target.trim()) {
        const parsed = parseTarget(target);
        if (!parsed) throw new AppError('RequestFailed', `not an address or range: ${target}`);
        addresses = parsed;
      } else {
        addresses = localNetworks().flatMap((network) => network.hosts);
      }

      // Typed keys win over the cloud's: the user may know better, e.g. after
      // re-pairing a device the cloud has not caught up with.
      const candidates = new Map<string, ScanCandidate>();
      for (const device of cloud.values()) {
        candidates.set(device.deviceId, { deviceId: device.deviceId, localKey: device.localKey });
      }
      for (const key of keys) candidates.set(key.deviceId, key);

      const result = await scanAddresses(addresses, [...candidates.values()], deps.scan);
      return { found: result.hits, unidentified: result.unidentified };
    },
  };
}
