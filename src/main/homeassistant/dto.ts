import { z } from 'zod';

/**
 * The Home Assistant wire format, narrowed to what the app uses.
 *
 * Everything optional is genuinely optional: attributes depend on what the
 * underlying integration reports, and a Tuya bulb behind the Tuya integration
 * exposes a different set from a Zigbee one. Anything unparsable is skipped
 * rather than fatal — one odd entity must not cost the user their whole house.
 */

/** https://developers.home-assistant.io/docs/core/entity/light#color-modes */
export const colorModeSchema = z.enum([
  'unknown',
  'onoff',
  'brightness',
  'color_temp',
  'hs',
  'xy',
  'rgb',
  'rgbw',
  'rgbww',
  'white',
]);

export type ColorMode = z.infer<typeof colorModeSchema>;

const rgbTupleSchema = z.tuple([z.number(), z.number(), z.number()]);

export const entityAttributesSchema = z
  .object({
    friendly_name: z.string().optional(),
    /** 0–255, and null while the light is off. */
    brightness: z.number().nullable().optional(),
    supported_color_modes: z.array(colorModeSchema).optional(),
    color_mode: colorModeSchema.nullable().optional(),
    rgb_color: rgbTupleSchema.nullable().optional(),
    color_temp_kelvin: z.number().nullable().optional(),
    min_color_temp_kelvin: z.number().optional(),
    max_color_temp_kelvin: z.number().optional(),
  })
  .loose();

export type EntityAttributes = z.infer<typeof entityAttributesSchema>;

export const entityStateSchema = z.object({
  entity_id: z.string(),
  /** 'on' | 'off' | 'unavailable' | 'unknown', and whatever else an integration invents. */
  state: z.string(),
  attributes: entityAttributesSchema.default({}),
});

export type EntityState = z.infer<typeof entityStateSchema>;

export const areaSchema = z.object({
  area_id: z.string(),
  name: z.string(),
});

export type Area = z.infer<typeof areaSchema>;

export const deviceSchema = z.object({
  id: z.string(),
  area_id: z.string().nullable().optional(),
});

export const entityRegistryEntrySchema = z.object({
  entity_id: z.string(),
  device_id: z.string().nullable().optional(),
  /** Set when the entity was moved out of its device's area by hand; it wins. */
  area_id: z.string().nullable().optional(),
});

/** The `state_changed` event payload: `new_state` is null when an entity is removed. */
export const stateChangedEventSchema = z.object({
  event_type: z.literal('state_changed'),
  data: z.object({
    entity_id: z.string(),
    new_state: entityStateSchema.nullable(),
  }),
});

/** Envelopes the socket sends; `type` is what tells them apart. */
export const socketMessageSchema = z
  .object({
    type: z.string(),
    id: z.number().optional(),
    success: z.boolean().optional(),
    result: z.unknown().optional(),
    event: z.unknown().optional(),
    message: z.string().optional(),
  })
  .loose();

export type SocketMessage = z.infer<typeof socketMessageSchema>;
