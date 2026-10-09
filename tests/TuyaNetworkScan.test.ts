import { describe, expect, it, vi } from 'vitest';

import { scanAddresses, type ScanDependencies } from '../src/main/tuya/TuyaNetworkScan';

/** A network where .10 is a 3.5 lamp, .11 a 3.3 bulb and .12 someone else's device. */
function fakeNetwork(): ScanDependencies {
  const devices: Record<string, { deviceId: string; key: string; version: string }> = {
    '192.168.1.10': { deviceId: 'lamp', key: 'lamp-key-16chars', version: '3.5' },
    '192.168.1.11': { deviceId: 'bulb', key: 'bulb-key-16chars', version: '3.3' },
    '192.168.1.12': { deviceId: 'neighbour', key: 'unknown-key-1234', version: '3.4' },
  };
  return {
    isOpen: vi.fn(async (address: string) => address in devices),
    answers: vi.fn(async (address, candidate, version) => {
      const device = devices[address];
      return (
        device !== undefined &&
        device.deviceId === candidate.deviceId &&
        device.key === candidate.localKey &&
        device.version === version
      );
    }),
  };
}

describe('scanAddresses', () => {
  it('finds each known device at its address and in its own protocol', async () => {
    const deps = fakeNetwork();
    const addresses = Array.from({ length: 20 }, (_, i) => `192.168.1.${i + 1}`);

    const result = await scanAddresses(
      addresses,
      [
        { deviceId: 'lamp', localKey: 'lamp-key-16chars' },
        { deviceId: 'bulb', localKey: 'bulb-key-16chars' },
      ],
      deps,
    );

    expect(result.hits).toEqual(
      expect.arrayContaining([
        { deviceId: 'lamp', address: '192.168.1.10', version: '3.5' },
        { deviceId: 'bulb', address: '192.168.1.11', version: '3.3' },
      ]),
    );
    // There, but answering to none of our keys.
    expect(result.unidentified).toEqual(['192.168.1.12']);
  });

  it('only tries keys on addresses that accept a connection', async () => {
    const deps = fakeNetwork();
    await scanAddresses(['192.168.1.99'], [{ deviceId: 'lamp', localKey: 'x'.repeat(16) }], deps);
    expect(deps.answers).not.toHaveBeenCalled();
  });

  it('still reports where devices are when there are no keys to try', async () => {
    const result = await scanAddresses(['192.168.1.10', '192.168.1.11'], [], fakeNetwork());
    expect(result).toEqual({ hits: [], unidentified: ['192.168.1.10', '192.168.1.11'] });
  });
});
