import type {
  Automation,
  Light,
  LightCapabilities,
  RgbColor,
  Room,
  Scene,
} from '../../shared/models';
import type { Area, ColorMode, EntityState } from './dto';

/**
 * Home Assistant entities to the domain model.
 *
 * Pure functions, like the Hue mapper, so the arithmetic can be tested without
 * a Home Assistant to talk to.
 */

/** Kelvin bounds for a light that reports none of its own. */
const DEFAULT_MIN_KELVIN = 2000;
const DEFAULT_MAX_KELVIN = 6535;

const COLOR_MODES: ReadonlySet<ColorMode> = new Set<ColorMode>([
  'hs',
  'xy',
  'rgb',
  'rgbw',
  'rgbww',
]);

export const domainOf = (entityId: string): string => entityId.split('.')[0] ?? '';

/** HA reports brightness 0–255; the domain model is a percentage. */
export function brightnessToUi(raw: number): number {
  return Math.round((Math.min(255, Math.max(0, raw)) / 255) * 100);
}

export function uiToBrightness(value: number): number {
  return Math.round((Math.min(100, Math.max(0, value)) / 100) * 255);
}

/**
 * 0–100 where 0 is warmest, matching the Hue side. Kelvin runs the other way
 * round from mirek — lower is warmer — so this needs no inversion, unlike
 * `mirekToUi`.
 */
export function kelvinToUi(kelvin: number, min: number, max: number): number {
  if (max <= min) return 50;
  const clamped = Math.min(max, Math.max(min, kelvin));
  return Math.round(((clamped - min) / (max - min)) * 100);
}

export function uiToKelvin(value: number, min: number, max: number): number {
  const t = Math.min(100, Math.max(0, value)) / 100;
  return Math.round(min + t * (max - min));
}

export function kelvinRangeOf(entity: EntityState): { min: number; max: number } {
  return {
    min: entity.attributes.min_color_temp_kelvin ?? DEFAULT_MIN_KELVIN,
    max: entity.attributes.max_color_temp_kelvin ?? DEFAULT_MAX_KELVIN,
  };
}

/**
 * A control is offered only when the light says it supports the mode — the same
 * capability-driven rule the Hue side follows.
 */
export function capabilitiesOf(entity: EntityState): LightCapabilities {
  const modes = entity.attributes.supported_color_modes ?? [];
  const color = modes.some((mode) => COLOR_MODES.has(mode));
  return {
    // Any colour mode implies a brightness channel, which is why this is not
    // just a check for 'brightness': an 'hs' light dims but never lists it.
    dimming: color || modes.includes('brightness') || modes.includes('color_temp'),
    colorTemperature: modes.includes('color_temp'),
    color,
  };
}

export function toLight(
  entity: EntityState,
  areaByEntity: ReadonlyMap<string, string>,
  providerId: string,
): Light {
  const capabilities = capabilitiesOf(entity);
  const isOn = entity.state === 'on';

  const raw = entity.attributes.brightness;
  const brightness = capabilities.dimming
    ? typeof raw === 'number'
      ? brightnessToUi(raw)
      : // Off lights report null rather than the level they will return to.
        isOn
        ? 100
        : 0
    : isOn
      ? 100
      : 0;

  const rgb = entity.attributes.rgb_color;
  const color: RgbColor | undefined =
    capabilities.color && rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : undefined;

  const kelvin = entity.attributes.color_temp_kelvin;
  const range = kelvinRangeOf(entity);
  const colorTemperature =
    capabilities.colorTemperature && typeof kelvin === 'number'
      ? kelvinToUi(kelvin, range.min, range.max)
      : undefined;

  return {
    id: entity.entity_id,
    providerId,
    name: entity.attributes.friendly_name ?? entity.entity_id,
    roomId: areaByEntity.get(entity.entity_id) ?? null,
    isOn,
    brightness,
    color,
    colorTemperature,
    capabilities,
  };
}

/**
 * An area becomes a room. Unlike Hue there is no grouped_light service to read,
 * so the state is always the aggregate of the member lights — and
 * `supportsGroupControl` is true regardless, because Home Assistant accepts an
 * `area_id` target natively and does the fan-out itself.
 */
export function toRoom(area: Area, lightsInRoom: readonly Light[], providerId: string): Room {
  const lit = lightsInRoom.filter((light) => light.isOn);

  return {
    id: area.area_id,
    providerId,
    name: area.name,
    lightIds: lightsInRoom.map((light) => light.id),
    isOn: lit.length > 0,
    brightness:
      lit.length > 0
        ? Math.round(lit.reduce((sum, light) => sum + light.brightness, 0) / lit.length)
        : 0,
    supportsGroupControl: true,
  };
}

export function toScene(
  entity: EntityState,
  areaByEntity: ReadonlyMap<string, string>,
  providerId: string,
): Scene {
  return {
    id: entity.entity_id,
    providerId,
    name: entity.attributes.friendly_name ?? entity.entity_id,
    roomId: areaByEntity.get(entity.entity_id) ?? null,
    // A scene entity's state is the timestamp it was last applied, never "on",
    // so Home Assistant simply cannot say which one is currently showing.
    isActive: false,
  };
}

export function toAutomation(entity: EntityState, providerId: string): Automation {
  return {
    id: entity.entity_id,
    providerId,
    name: entity.attributes.friendly_name ?? entity.entity_id,
    enabled: entity.state === 'on',
  };
}
