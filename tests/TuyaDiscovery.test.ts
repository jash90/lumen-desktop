import { describe, expect, it } from 'vitest';

import { decodeAnnouncement } from '../src/main/tuya/TuyaDiscoveryService';
import { localNetworks } from '../src/main/tuya/localNetworks';
import { hostsIn, parseTarget } from '../src/shared/ipRange';
import vectors from './fixtures/tuya-protocol-vectors.json';

describe('decodeAnnouncement', () => {
  it('reads a 3.5 announcement from port 7000', () => {
    expect(decodeAnnouncement(Buffer.from(vectors.v35.announcement, 'hex'))).toEqual(
      JSON.parse(vectors.v35.announcementJson),
    );
  });

  it('ignores a GCM frame that does not authenticate', () => {
    const frame = Buffer.from(vectors.v35.announcement, 'hex');
    frame[40] = frame[40]! ^ 0xff;
    expect(decodeAnnouncement(frame)).toBeNull();
  });
});

describe('hostsIn', () => {
  it('lists the hosts of a /24 without the network and broadcast addresses', () => {
    const hosts = hostsIn('192.168.1.77', 24);
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts.at(-1)).toBe('192.168.1.254');
  });

  it('narrows anything broader than a /24 to the /24 around the address', () => {
    expect(hostsIn('10.0.5.9', 16)).toHaveLength(254);
    expect(hostsIn('10.0.5.9', 16)[0]).toBe('10.0.5.1');
  });
});

describe('parseTarget', () => {
  it('accepts one address, a CIDR range and a short dash range', () => {
    expect(parseTarget('192.168.1.40')).toEqual(['192.168.1.40']);
    expect(parseTarget('192.168.1.0/30')).toEqual(['192.168.1.1', '192.168.1.2']);
    expect(parseTarget(' 192.168.1.10-12 ')).toEqual([
      '192.168.1.10',
      '192.168.1.11',
      '192.168.1.12',
    ]);
  });

  it('rejects anything else', () => {
    expect(parseTarget('kitchen lamp')).toBeNull();
    expect(parseTarget('192.168.1.300')).toBeNull();
    expect(parseTarget('192.168.1.20-10')).toBeNull();
  });
});

describe('localNetworks', () => {
  it('derives the broadcast address and skips loopback and link-local', () => {
    const networks = localNetworks({
      lo0: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
      en0: [
        {
          address: '192.168.10.20',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: 'aa:bb:cc:dd:ee:ff',
          internal: false,
          cidr: null,
        },
        {
          address: '169.254.3.4',
          netmask: '255.255.0.0',
          family: 'IPv4',
          mac: 'aa:bb:cc:dd:ee:ff',
          internal: false,
          cidr: '169.254.3.4/16',
        },
      ],
    });

    expect(networks).toHaveLength(1);
    expect(networks[0]).toMatchObject({ address: '192.168.10.20', broadcast: '192.168.10.255' });
    expect(networks[0]?.hosts).toHaveLength(253);
    expect(networks[0]?.hosts).not.toContain('192.168.10.20');
  });
});
