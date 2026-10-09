/**
 * IPv4 address arithmetic for the Tuya address scan.
 *
 * Shared so the form can check what was typed before it is sent, and the main
 * process can expand the same text into addresses.
 */

export const toInt = (ip: string): number =>
  ip.split('.').reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;

export const toIp = (value: number): string =>
  [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');

export const isIpv4 = (value: string): boolean =>
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(value);

/**
 * Host addresses in a range, never more than a /24.
 *
 * A /16 is 65 000 connection attempts, which on a home network is minutes of
 * traffic for devices that are all in one /24 anyway. A broader mask is
 * narrowed to the /24 around the given address.
 */
export function hostsIn(address: string, prefix: number): string[] {
  const effective = Math.max(prefix, 24);
  const mask = effective === 0 ? 0 : (0xffffffff << (32 - effective)) >>> 0;
  const network = (toInt(address) & mask) >>> 0;
  const size = 2 ** (32 - effective);
  // A /31 or /32 has no network or broadcast address to skip.
  if (size <= 2) return Array.from({ length: size }, (_, i) => toIp(network + i));
  return Array.from({ length: size - 2 }, (_, i) => toIp(network + i + 1));
}

/** `192.168.1.0/24`, `192.168.1.40` or `192.168.1.10-60`, as typed by a person. */
export function parseTarget(input: string): string[] | null {
  const value = input.trim();
  if (isIpv4(value)) return [value];

  const cidr = /^([\d.]+)\/(\d{1,2})$/.exec(value);
  if (cidr && isIpv4(cidr[1]!) && Number(cidr[2]) <= 32) {
    return hostsIn(cidr[1]!, Number(cidr[2]));
  }

  const range = /^([\d.]+)-(\d{1,3})$/.exec(value);
  if (range && isIpv4(range[1]!)) {
    const start = toInt(range[1]!);
    const last = ((start & 0xffffff00) >>> 0) + Number(range[2]);
    if (Number(range[2]) > 255 || last < start) return null;
    return Array.from({ length: last - start + 1 }, (_, i) => toIp(start + i));
  }

  return null;
}
