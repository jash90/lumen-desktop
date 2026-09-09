import { z } from 'zod';

/**
 * The Tuya wire payloads, narrowed to what the app uses.
 *
 * Everything here is remote input arriving over a socket, so nothing is
 * asserted: a frame that does not parse is skipped, exactly as the Hue and Home
 * Assistant adapters skip a resource they cannot read.
 */

/**
 * A data point value. Tuya sends booleans, numbers and strings, and which one
 * depends on the data point rather than on anything in the frame.
 */
export const dpValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export type DpValue = z.infer<typeof dpValueSchema>;

/**
 * Both a query reply and an unsolicited status push carry this. Keys are the
 * data point indices as strings — `"20"`, `"22"` — never numbers.
 */
export const dpsPayloadSchema = z
  .object({
    dps: z.record(z.string(), dpValueSchema),
    /** Present on pushes; the device's own clock, which we do not rely on. */
    t: z.union([z.number(), z.string()]).optional(),
  })
  .loose();

export type DpsPayload = z.infer<typeof dpsPayloadSchema>;

/**
 * The UDP announcement a device broadcasts every few seconds.
 *
 * `gwId` is the device id and the only stable identifier — `ip` moves with the
 * DHCP lease, which is what makes re-discovery the recovery path after a failed
 * connect.
 */
export const announcementSchema = z
  .object({
    gwId: z.string().min(1),
    ip: z.string().min(1),
    version: z.string().optional(),
    productKey: z.string().optional(),
    encrypt: z.boolean().optional(),
  })
  .loose();

export type Announcement = z.infer<typeof announcementSchema>;

/**
 * Type B data points (20–27), which is what the bulbs on this network use.
 *
 * Read off the hardware rather than taken from a table:
 * `{'20': false, '21': 'white', '22': 140, '23': 0, '24': '000003e803e8', '26': 0}`
 */
export const Dp = {
  power: '20',
  /** `'white'` or `'colour'`; writing a colour flips it on its own. */
  mode: '21',
  brightness: '22',
  colorTemperature: '23',
  /** `HHHHSSSSVVVV` — see TuyaColor. */
  color: '24',
  scene: '25',
  countdown: '26',
} as const;

export type WorkMode = 'white' | 'colour';
