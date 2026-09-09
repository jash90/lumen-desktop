import { AppError } from '../../shared/errors';
import type {
  ProviderCredential,
  TuyaCredential,
  TuyaDeviceCredential,
} from '../providers/ProviderCredential';
import { dpsPayloadSchema } from './dto';
import { TuyaCommand } from './TuyaCodec';
import { classifyDevice, type TuyaDeviceKind } from './TuyaDeviceKind';
import { openTuyaTransport, type TuyaTransport } from './TuyaTransport';

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

/**
 * Asks each device what it is before anything is stored.
 *
 * A Tuya device announces an id and nothing else, so the only way to know
 * whether it is a bulb is to connect and look at the data points it reports.
 * Doing that here rather than after storing means a thermometer typed in by
 * mistake comes back as a message in the form, not as a silent entry that
 * never shows a light.
 */
export interface ProbedDevice {
  device: TuyaDeviceCredential;
  kind: TuyaDeviceKind;
}

export async function probeDevices(
  devices: readonly TuyaDeviceCredential[],
): Promise<ProbedDevice[]> {
  return Promise.all(
    devices.map(async (device): Promise<ProbedDevice> => {
      let transport: TuyaTransport | null = null;
      try {
        transport = await openTuyaTransport({
          deviceId: device.deviceId,
          address: device.address,
          localKey: device.localKey,
          onPush: () => undefined,
          onClosed: () => undefined,
        });
        const reply = await transport.request(TuyaCommand.DP_QUERY, {
          gwId: device.deviceId,
          devId: device.deviceId,
        });
        const parsed = dpsPayloadSchema.safeParse(JSON.parse(reply));
        return { device, kind: parsed.success ? classifyDevice(parsed.data.dps) : 'unknown' };
      } catch (error) {
        // A wrong key or an unreachable device is not a classification —
        // surface it as itself so the form can say which one it was.
        throw error instanceof AppError
          ? error
          : new AppError('BridgeOffline', `${device.name} did not answer`, { cause: error });
      } finally {
        transport?.close();
      }
    }),
  );
}
