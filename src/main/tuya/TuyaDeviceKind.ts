import { Dp, type DpValue } from './dto';

/**
 * Works out what a Tuya device actually is from the data points it reports.
 *
 * Necessary because a Tuya device announces an id and nothing else — no class,
 * no model, no hint that it is a bulb rather than a thermometer. Without this
 * every configured device would appear in the app as a light, including the
 * ones that cannot be switched at all.
 *
 * The classification is by **type as well as index**, and that is the whole
 * trick. A metering socket reports data point 20 as a voltage; a type-B bulb
 * reports the same index as its on/off switch. Matching on the index alone
 * would file a socket as a bulb — and this network has one of each.
 */

export type TuyaDeviceKind = 'light' | 'switch' | 'sensor' | 'unknown';

/** Type A bulbs put the same things on 1–5 that type B puts on 20–24. */
const TYPE_A = { power: '1', mode: '2', brightness: '3', temperature: '4', color: '5' } as const;

const isBool = (value: DpValue | undefined): value is boolean => typeof value === 'boolean';

const hasAny = (dps: Record<string, DpValue>, keys: readonly string[]): boolean =>
  keys.some((key) => key in dps);

export function classifyDevice(dps: Record<string, DpValue>): TuyaDeviceKind {
  if (Object.keys(dps).length === 0) return 'unknown';

  // Type B: a boolean switch on 20 with at least one lighting control beside it.
  if (isBool(dps[Dp.power]) && hasAny(dps, [Dp.mode, Dp.brightness, Dp.colorTemperature, Dp.color])) {
    return 'light';
  }

  // Type A: the same shape on the low indices. The mode data point is a string
  // there, which is what separates a bulb from a socket that happens to report
  // a number on 2.
  if (isBool(dps[TYPE_A.power])) {
    const looksLikeBulb =
      typeof dps[TYPE_A.mode] === 'string' ||
      typeof dps[TYPE_A.brightness] === 'number' ||
      typeof dps[TYPE_A.color] === 'string';
    if (looksLikeBulb) return 'light';
    // A boolean and nothing to dim: a socket, a relay, a switch.
    return 'switch';
  }

  // A switch on 20 with no lighting controls is still something you can turn on.
  if (isBool(dps[Dp.power])) return 'switch';

  // Everything left that only reports readings — a thermometer, a door contact.
  const readable = Object.values(dps).some((value) => typeof value === 'number');
  return readable ? 'sensor' : 'unknown';
}

/** What to tell the user about a device this app cannot drive. */
export function describeKind(kind: TuyaDeviceKind): string {
  switch (kind) {
    case 'light':
      return 'light';
    case 'switch':
      return 'a switch or socket, not a light';
    case 'sensor':
      return 'a sensor — it reports readings and cannot be switched';
    default:
      return 'not recognisable as a light';
  }
}
