import os from 'node:os';

import { hostsIn, toInt, toIp } from '../../shared/ipRange';

/**
 * The IPv4 networks this machine sits on, as discovery and the address scan
 * need them: where to broadcast, and which addresses to try.
 *
 * Pure apart from the default argument, so the arithmetic is testable with a
 * made-up interface table.
 */

export interface LocalNetwork {
  /** This machine's address on the network. */
  address: string;
  broadcast: string;
  /** Every host address to try, capped to the /24 around `address`. */
  hosts: string[];
}

export function localNetworks(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LocalNetwork[] {
  const networks: LocalNetwork[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      // Link-local means no DHCP answered; nothing to find there.
      if (entry.address.startsWith('169.254.')) continue;
      const mask = toInt(entry.netmask);
      const prefix = entry.cidr ? Number(entry.cidr.split('/')[1]) : Math.clz32(~mask >>> 0);
      networks.push({
        address: entry.address,
        broadcast: toIp((toInt(entry.address) | (~mask >>> 0)) >>> 0),
        hosts: hostsIn(entry.address, prefix).filter((host) => host !== entry.address),
      });
    }
  }
  return networks;
}
