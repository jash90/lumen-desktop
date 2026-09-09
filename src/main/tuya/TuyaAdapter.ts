import { AppError } from '../../shared/errors';
import { backoffDelay, BACKOFF_STEPS_MS } from '../backoff';
import type { ProviderAdapter, ProviderSession } from '../providers/LightingProvider';
import type {
  TuyaCredential,
  TuyaDeviceCredential,
} from '../providers/ProviderCredential';
import type { ProviderRepository } from '../providers/ProviderRepository';
import { createTuyaApi, type TuyaDeviceHandle } from './TuyaApi';
import { dpsPayloadSchema, type DpValue } from './dto';
import { TuyaCommand } from './TuyaCodec';
import { openTuyaTransport, type TuyaTransport } from './TuyaTransport';
import type { TuyaDiscoveryService } from './TuyaDiscoveryService';

/**
 * Every LAN device behind one provider session.
 *
 * The important difference from Hue and Home Assistant: there is no hub, so
 * this session owns N sockets rather than one. That shapes its failure rules.
 *
 *   - Connecting succeeds if **at least one** device answers. Demanding all of
 *     them would mean a single unplugged bulb takes the whole provider down.
 *   - A device that drops retries **inside** the session, on its own backoff,
 *     and contributes no light until it is back.
 *   - `onClosed` fires only when **every** device is gone. Otherwise the
 *     connection layer outside would tear down a hub that is mostly working.
 */

export interface TuyaAdapterOptions {
  repository: ProviderRepository;
  discovery: TuyaDiscoveryService;
}

interface DeviceRuntime extends TuyaDeviceHandle {
  credential: TuyaDeviceCredential;
  connect(): Promise<void>;
  stop(): void;
}

export function createTuyaAdapter(options: TuyaAdapterOptions): ProviderAdapter<TuyaCredential> {
  const { repository, discovery } = options;

  return {
    kind: 'tuya',

    async connect(credential, hooks): Promise<ProviderSession> {
      let stopped = false;
      const runtimes: DeviceRuntime[] = [];

      const anyReachable = (): boolean => runtimes.some((device) => device.reachable());

      const createRuntime = (device: TuyaDeviceCredential): DeviceRuntime => {
        let transport: TuyaTransport | null = null;
        let dps: Record<string, DpValue> = {};
        let attempt = 0;
        let retry: NodeJS.Timeout | null = null;

        const merge = (text: string): boolean => {
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            return false;
          }
          const parsed = dpsPayloadSchema.safeParse(body);
          if (!parsed.success) return false;
          dps = { ...dps, ...parsed.data.dps };
          return true;
        };

        const scheduleRetry = (): void => {
          if (stopped || retry) return;
          const delay = backoffDelay(attempt);
          attempt = Math.min(attempt + 1, BACKOFF_STEPS_MS.length - 1);
          retry = setTimeout(() => {
            retry = null;
            void runtime.connect().catch(() => undefined);
          }, delay);
          retry.unref();
        };

        const onGone = (): void => {
          transport = null;
          if (stopped) return;
          // Only when the last one goes does the provider count as down.
          if (!anyReachable()) hooks.onClosed();
          scheduleRetry();
        };

        const runtime: DeviceRuntime = {
          credential: device,
          deviceId: device.deviceId,
          name: device.name,
          state: () => dps,
          reachable: () => transport !== null,

          async connect() {
            if (stopped || transport) return;

            const active = await openTuyaTransport({
              deviceId: device.deviceId,
              address: device.address,
              localKey: device.localKey,
              onPush: (text) => {
                if (!merge(text)) return;
                const changes = api.applyUpdates([
                  { deviceId: device.deviceId, payload: JSON.parse(text) },
                ]);
                if (changes.lights.length > 0) hooks.onChanges(changes);
              },
              onClosed: onGone,
            });

            const reply = await active.request(TuyaCommand.DP_QUERY, {
              gwId: device.deviceId,
              devId: device.deviceId,
            });
            merge(reply);

            if (stopped) {
              active.close();
              return;
            }

            transport = active;
            attempt = 0;
          },

          async write(next) {
            if (!transport) {
              throw new AppError('ResourceUnavailable', `${device.name} is not reachable`);
            }
            await transport.request(TuyaCommand.CONTROL, {
              devId: device.deviceId,
              uid: device.deviceId,
              t: Math.floor(Date.now() / 1000).toString(),
              dps: next,
            });
            // The device echoes the new state as a push, but applying it here
            // too means the UI does not wait a round trip to look right.
            dps = { ...dps, ...next };
          },

          stop() {
            if (retry) clearTimeout(retry);
            retry = null;
            transport?.close();
            transport = null;
          },
        };

        return runtime;
      };

      for (const device of credential.devices) runtimes.push(createRuntime(device));

      const api = createTuyaApi({
        providerId: credential.id,
        devices: runtimes,
        async refreshAll() {
          await Promise.allSettled(
            runtimes.map(async (device) => {
              if (!device.reachable()) return device.connect();
              return undefined;
            }),
          );
        },
      });

      // Settled, not all: one unplugged bulb must not fail the whole provider.
      await Promise.allSettled(runtimes.map((device) => device.connect()));

      if (!anyReachable()) {
        runtimes.forEach((device) => device.stop());
        const only = credential.devices.length === 1 ? credential.devices[0]?.name : null;
        throw new AppError(
          'BridgeOffline',
          only ? `${only} did not answer` : 'no Tuya device answered',
        );
      }

      return {
        api,
        detail() {
          const up = runtimes.filter((device) => device.reachable()).length;
          return up === runtimes.length
            ? `${up} ${up === 1 ? 'device' : 'devices'}`
            : `${up} of ${runtimes.length} devices`;
        },
        stop() {
          stopped = true;
          runtimes.forEach((device) => device.stop());
        },
      };
    },

    /**
     * A device that stopped answering has usually just taken a new DHCP lease.
     * Re-discovery matches by device id — the one thing that does not move —
     * and returns the credential with corrected addresses, or null when nothing
     * actually changed, which is what stops the connection layer looping.
     */
    async recover(credential) {
      const found = await discovery.discover();
      if (found.length === 0) return null;

      const addressOf = new Map(found.map((device) => [device.deviceId, device.address]));
      let changed = false;

      const devices = credential.devices.map((device) => {
        const address = addressOf.get(device.deviceId);
        if (!address || address === device.address) return device;
        changed = true;
        return { ...device, address };
      });

      if (!changed) return null;

      const updated: TuyaCredential = { ...credential, devices };
      repository.save(updated);
      return updated;
    },
  };
}
