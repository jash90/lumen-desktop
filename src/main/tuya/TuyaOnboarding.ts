import type {
  ProviderCredential,
  TuyaCredential,
  TuyaDeviceCredential,
} from '../providers/ProviderCredential';

/**
 * All LAN devices live under one provider entry.
 *
 * They have no hub in reality, but the registry keys a connection per
 * credential, and one credential per bulb would list every bulb in Settings as
 * though it were a bridge. A fixed id also means adding a second device later
 * updates the entry instead of creating a rival one.
 */
export const TUYA_PROVIDER_ID = 'tuya-local';

export function buildTuyaCredential(
  devices: readonly TuyaDeviceCredential[],
  existing: ProviderCredential | null,
): TuyaCredential {
  const previous = existing?.kind === 'tuya' ? existing.devices : [];

  // Merge rather than replace: connecting a new bulb must not silently drop the
  // ones already configured.
  const merged = new Map(previous.map((device) => [device.deviceId, device]));
  for (const device of devices) merged.set(device.deviceId, device);

  return {
    kind: 'tuya',
    id: TUYA_PROVIDER_ID,
    name: 'Tuya (local)',
    address: 'local network',
    devices: [...merged.values()],
  };
}
