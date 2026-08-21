import { z } from 'zod';

/**
 * Hue API v2 wire format. These schemas exist so a firmware change produces a
 * clear validation failure instead of `undefined` surfacing three layers up.
 *
 * Unknown properties are stripped rather than rejected — Signify adds fields to
 * these resources between firmware releases and that must not break the app.
 */

const resourceRef = z.object({
  rid: z.string(),
  rtype: z.string(),
});

export const lightDtoSchema = z.object({
  id: z.string(),
  /** The device providing this light; also how a light is matched to a room. */
  owner: resourceRef,
  metadata: z.object({ name: z.string() }),
  on: z.object({ on: z.boolean() }),
  /** Absent on bulbs that cannot dim. Brightness is a percentage, not 0–254 as in API v1. */
  dimming: z
    .object({
      brightness: z.number(),
      min_dim_level: z.number().optional(),
    })
    .optional(),
  color_temperature: z
    .object({
      mirek: z.number().nullable().optional(),
      mirek_valid: z.boolean().optional(),
      mirek_schema: z
        .object({ mirek_minimum: z.number(), mirek_maximum: z.number() })
        .optional(),
    })
    .optional(),
  color: z
    .object({
      xy: z.object({ x: z.number(), y: z.number() }),
      gamut: z
        .object({
          red: z.object({ x: z.number(), y: z.number() }),
          green: z.object({ x: z.number(), y: z.number() }),
          blue: z.object({ x: z.number(), y: z.number() }),
        })
        .optional(),
      gamut_type: z.string().optional(),
    })
    .optional(),
});

export const roomDtoSchema = z.object({
  id: z.string(),
  /** Devices in the room — matched against `light.owner.rid`. */
  children: z.array(resourceRef),
  /** Contains the room's `grouped_light` service (PRD §9). */
  services: z.array(resourceRef),
  metadata: z.object({ name: z.string() }),
});

export const groupedLightDtoSchema = z.object({
  id: z.string(),
  owner: resourceRef.optional(),
  on: z.object({ on: z.boolean() }).optional(),
  dimming: z.object({ brightness: z.number() }).optional(),
});

export const sceneDtoSchema = z.object({
  id: z.string(),
  metadata: z.object({ name: z.string() }),
  /** The room or zone the scene belongs to — scenes are never global. */
  group: resourceRef,
  /** `active` is 'inactive' or a recall state; it tells the UI which scene is on. */
  status: z.object({ active: z.string().optional() }).optional(),
});

export const bridgeConfigSchema = z.object({
  name: z.string(),
  bridgeid: z.string(),
  modelid: z.string().optional(),
  swversion: z.string().optional(),
});

/** Envelope wrapping every /clip/v2 response. */
export const envelopeSchema = z.object({
  errors: z.array(z.object({ description: z.string() })).optional(),
  data: z.array(z.unknown()).optional(),
});

/** Pairing responses are API v1 shaped, even for v2 clients. */
export const pairingResponseSchema = z.array(
  z.object({
    success: z.object({ username: z.string() }).optional(),
    error: z
      .object({ type: z.number(), description: z.string() })
      .optional(),
  }),
);

export const cloudDiscoverySchema = z.array(
  z.object({
    id: z.string(),
    internalipaddress: z.string(),
  }),
);

export type LightDto = z.infer<typeof lightDtoSchema>;
export type RoomDto = z.infer<typeof roomDtoSchema>;
export type GroupedLightDto = z.infer<typeof groupedLightDtoSchema>;
export type SceneDto = z.infer<typeof sceneDtoSchema>;
export type BridgeConfigDto = z.infer<typeof bridgeConfigSchema>;
