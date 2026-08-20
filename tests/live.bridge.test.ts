import { describe, expect, it } from 'vitest';

import { probeBridge } from '../src/main/bridge/BridgeDiscoveryService';

/**
 * Hardware smoke test (PRD §35).
 *
 * Skipped unless a bridge address is supplied, so CI stays green without one:
 *   HUE_BRIDGE_IP=192.168.1.42 npm test
 *
 * It exercises the part that cannot be faked convincingly — the real TLS
 * handshake against Signify's certificate chain.
 */
const ip = process.env.HUE_BRIDGE_IP;

describe.skipIf(!ip)('live bridge', () => {
  it('completes a verified TLS handshake and reports its id', async () => {
    const probe = await probeBridge(ip!);

    expect(probe.bridgeId).toMatch(/^[0-9a-f]{16}$/);
    expect(probe.config.bridgeid.toLowerCase()).toBe(probe.bridgeId);
    expect(probe.config.modelid).toBeTruthy();
  });

  it('rejects an address that is not a Hue Bridge', async () => {
    await expect(probeBridge('127.0.0.1')).rejects.toBeDefined();
  });
});
