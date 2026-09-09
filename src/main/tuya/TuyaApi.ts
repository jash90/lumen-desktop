import { AppError } from '../../shared/errors';
import type { Light, LightCapabilities, Room } from '../../shared/models';
import type { ChangeSet, LightingApi } from '../providers/LightingProvider';
import { Dp, dpsPayloadSchema, type DpValue } from './dto';
import { levelToUi, rgbToTuyaColor, tuyaColorToRgb, uiToLevel } from './TuyaColor';

/**
 * `LightingApi` over a set of Tuya devices reached directly on the LAN.
 *
 * Each device is its own socket, so unlike the Hue and Home Assistant adapters
 * there is no hub to ask for a list — the set is whatever the user configured.
 * Rooms, scenes and automations come back empty: a Tuya bulb exposes none of
 * them locally, and the registry simply concatenates the empty lists.
 */

/**
 * How long consecutive writes to one device are merged before going out.
 *
 * A slider fires dozens of events a second. The renderer already throttles, but
 * that value is tuned for a Hue bridge and hardcoded in the components — and
 * the tray and global shortcuts bypass the renderer entirely. So coalescing
 * happens here, where every write passes regardless of origin.
 */
export const WRITE_COALESCE_MS = 200;

export interface TuyaDeviceHandle {
  deviceId: string;
  name: string;
  /** Sends a set of data points; resolves once the device has taken them. */
  write(dps: Record<string, DpValue>): Promise<void>;
  /** Last known data points, kept up to date by the caller. */
  state(): Record<string, DpValue>;
  /** False while the device is unreachable; it contributes no light then. */
  reachable(): boolean;
}

export interface TuyaApiOptions {
  providerId: string;
  devices: readonly TuyaDeviceHandle[];
  refreshAll(): Promise<void>;
}

const asNumber = (value: DpValue | undefined): number | undefined =>
  typeof value === 'number' ? value : undefined;

/**
 * What the bulb reports is what it can do: a device that never sends a colour
 * data point has no colour, and offering the control would be a lie.
 */
export function capabilitiesOf(dps: Record<string, DpValue>): LightCapabilities {
  return {
    dimming: Dp.brightness in dps,
    colorTemperature: Dp.colorTemperature in dps,
    color: Dp.color in dps,
  };
}

export function toLight(
  handle: TuyaDeviceHandle,
  providerId: string,
): Light {
  const dps = handle.state();
  const capabilities = capabilitiesOf(dps);
  const isOn = dps[Dp.power] === true;

  const rawBrightness = asNumber(dps[Dp.brightness]);
  const brightness = capabilities.dimming
    ? isOn && rawBrightness !== undefined
      ? levelToUi(rawBrightness)
      : 0
    : isOn
      ? 100
      : 0;

  const rawColor = dps[Dp.color];
  const inColourMode = dps[Dp.mode] === 'colour';
  const color =
    capabilities.color && inColourMode && typeof rawColor === 'string'
      ? (tuyaColorToRgb(rawColor) ?? undefined)
      : undefined;

  const rawTemperature = asNumber(dps[Dp.colorTemperature]);
  const colorTemperature =
    capabilities.colorTemperature && !inColourMode && rawTemperature !== undefined
      ? levelToUi(rawTemperature)
      : undefined;

  return {
    id: handle.deviceId,
    providerId,
    name: handle.name,
    // A Tuya device knows nothing about rooms, so every light is ungrouped and
    // shows up under "Outside rooms".
    roomId: null,
    isOn,
    brightness,
    color,
    colorTemperature,
    capabilities,
  };
}

export function createTuyaApi(options: TuyaApiOptions): LightingApi {
  const { providerId, devices, refreshAll } = options;

  const byId = new Map(devices.map((device) => [device.deviceId, device]));

  /** Writes waiting to be merged, per device. */
  const buffered = new Map<string, Record<string, DpValue>>();
  const timers = new Map<string, NodeJS.Timeout>();
  const waiters = new Map<string, { resolve(): void; reject(error: unknown): void }[]>();

  const require_ = (id: string): TuyaDeviceHandle => {
    const device = byId.get(id);
    if (!device) throw new AppError('ResourceUnavailable', `unknown device ${id}`);
    return device;
  };

  /**
   * Merges a write into whatever is already queued for that device and returns
   * a promise that settles when the merged batch actually goes out. Two rapid
   * slider steps become one frame; the caller still learns whether it worked.
   */
  const write = (id: string, dps: Record<string, DpValue>): Promise<void> => {
    const device = require_(id);
    buffered.set(id, { ...(buffered.get(id) ?? {}), ...dps });

    const pending = waiters.get(id) ?? [];
    const settled = new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
    waiters.set(id, pending);

    if (!timers.has(id)) {
      const timer = setTimeout(() => {
        timers.delete(id);
        const batch = buffered.get(id) ?? {};
        buffered.delete(id);
        const settling = waiters.get(id) ?? [];
        waiters.delete(id);

        device
          .write(batch)
          .then(() => settling.forEach((w) => w.resolve()))
          .catch((error: unknown) => settling.forEach((w) => w.reject(error)));
      }, WRITE_COALESCE_MS);
      timer.unref();
      timers.set(id, timer);
    }

    return settled;
  };

  const live = (): TuyaDeviceHandle[] => devices.filter((device) => device.reachable());

  return {
    refresh: refreshAll,

    getLights: () => live().map((device) => toLight(device, providerId)),
    getLight: (id) => toLight(require_(id), providerId),

    // A Tuya device has none of these locally; the registry concatenates the
    // empty lists and the UI simply shows nothing extra.
    getRooms: () => [],
    getScenes: () => [],
    getAutomations: () => [],

    getRoom(id) {
      throw new AppError('ResourceUnavailable', `no rooms on this hub (${id})`);
    },

    setRoomPower(id) {
      throw new AppError('ResourceUnavailable', `no rooms on this hub (${id})`);
    },

    setRoomBrightness(id) {
      throw new AppError('ResourceUnavailable', `no rooms on this hub (${id})`);
    },

    activateScene(id) {
      throw new AppError('UnsupportedCapability', `scenes are not available locally (${id})`);
    },

    setAutomationEnabled(id) {
      throw new AppError('UnsupportedCapability', `automations are not available locally (${id})`);
    },

    setLightPower: (id, on) => write(id, { [Dp.power]: on }),

    setLightBrightness: (id, brightness) =>
      // Zero is not a level these devices accept — switching off is the power
      // data point's job.
      brightness === 0
        ? write(id, { [Dp.power]: false })
        : write(id, {
            [Dp.power]: true,
            [Dp.mode]: 'white',
            [Dp.brightness]: uiToLevel(brightness),
          }),

    setLightColor: (id, color) =>
      write(id, {
        [Dp.power]: true,
        [Dp.mode]: 'colour',
        [Dp.color]: rgbToTuyaColor(color),
      }),

    setLightTemperature: (id, temperature) =>
      write(id, {
        [Dp.power]: true,
        [Dp.mode]: 'white',
        [Dp.colorTemperature]: uiToLevel(temperature),
      }),

    applyUpdates(updates) {
      const lights: Light[] = [];

      for (const update of updates) {
        // The socket is remote input; a frame we cannot read is skipped rather
        // than thrown out through the connection's callback.
        if (typeof update !== 'object' || update === null) continue;
        const entry = update as { deviceId?: unknown; payload?: unknown };
        if (typeof entry.deviceId !== 'string') continue;

        const parsed = dpsPayloadSchema.safeParse(entry.payload);
        if (!parsed.success) continue;

        const device = byId.get(entry.deviceId);
        if (!device) continue;

        lights.push(toLight(device, providerId));
      }

      return { lights, rooms: [] as Room[] } satisfies ChangeSet;
    },
  };
}
