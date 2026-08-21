import type { Light, LightCapabilities, RgbColor, Room, Scene } from '../../shared/models';
import type { GroupedLightDto, LightDto, RoomDto, SceneDto } from './dto';
import { DEFAULT_GAMUT, type Gamut, rgbToXy, xyToRgb } from './HueColor';

/**
 * The only place that knows both the Hue wire format and the domain model
 * (PRD §12, §47). Everything here is pure, which is what makes it testable
 * without a bridge.
 */

/** Mirek = 1e6/Kelvin. Low mirek is cold light, high mirek is warm — inverted vs the UI slider. */
export interface MirekSchema {
  mirek_minimum: number;
  mirek_maximum: number;
}

export const DEFAULT_MIREK_SCHEMA: MirekSchema = { mirek_minimum: 153, mirek_maximum: 500 };

/**
 * A Hue light rejects brightness 0 — "off" is a separate property. The UI domain
 * is a plain 0–100 %, so callers that really mean 0 must switch the light off.
 */
export const MIN_BRIGHTNESS = 1;
export const MAX_BRIGHTNESS = 100;

export const clampBrightness = (value: number): number =>
  Math.min(MAX_BRIGHTNESS, Math.max(MIN_BRIGHTNESS, Math.round(value)));

/** mirek -> 0–100 where 0 is the warmest the bulb can go and 100 the coldest. */
export function mirekToUi(mirek: number, schema: MirekSchema = DEFAULT_MIREK_SCHEMA): number {
  const { mirek_minimum: min, mirek_maximum: max } = schema;
  if (max === min) return 50;
  const clamped = Math.min(max, Math.max(min, mirek));
  return Math.round(((max - clamped) / (max - min)) * 100);
}

/** Inverse of {@link mirekToUi}. */
export function uiToMirek(value: number, schema: MirekSchema = DEFAULT_MIREK_SCHEMA): number {
  const { mirek_minimum: min, mirek_maximum: max } = schema;
  const t = Math.min(100, Math.max(0, value)) / 100;
  return Math.round(max - t * (max - min));
}

/** A control is offered only when the bulb actually reports the matching resource. */
export function capabilitiesOf(dto: LightDto): LightCapabilities {
  return {
    dimming: dto.dimming !== undefined,
    colorTemperature: dto.color_temperature !== undefined,
    color: dto.color !== undefined,
  };
}

export function gamutOf(dto: LightDto): Gamut {
  return dto.color?.gamut ?? DEFAULT_GAMUT;
}

export function mirekSchemaOf(dto: LightDto): MirekSchema {
  return dto.color_temperature?.mirek_schema ?? DEFAULT_MIREK_SCHEMA;
}

/**
 * @param roomIdByDeviceId maps `light.owner.rid` to a room; a light whose device
 *   belongs to no room still shows up, just ungrouped.
 */
export function toLight(dto: LightDto, roomIdByDeviceId: ReadonlyMap<string, string>): Light {
  const capabilities = capabilitiesOf(dto);
  const isOn = dto.on.on;

  // Non-dimmable bulbs have no brightness of their own; report the only two
  // levels they have so the UI does not need a special case.
  const brightness = dto.dimming
    ? Math.round(dto.dimming.brightness)
    : isOn
      ? 100
      : 0;

  // mirek is null while the bulb is showing a colour rather than white.
  const mirek = dto.color_temperature?.mirek;
  const colorTemperature =
    capabilities.colorTemperature && typeof mirek === 'number'
      ? mirekToUi(mirek, mirekSchemaOf(dto))
      : undefined;

  const color = dto.color ? xyToRgb(dto.color.xy) : undefined;

  return {
    id: dto.id,
    name: dto.metadata.name,
    roomId: roomIdByDeviceId.get(dto.owner.rid) ?? null,
    isOn,
    brightness,
    color,
    colorTemperature,
    capabilities,
  };
}

/** device rid -> room id, built once per refresh and reused for every light. */
export function buildRoomIndex(rooms: readonly RoomDto[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const room of rooms) {
    for (const child of room.children) {
      if (child.rtype === 'device') index.set(child.rid, room.id);
    }
  }
  return index;
}

export function groupedLightIdOf(room: RoomDto): string | null {
  return room.services.find((service) => service.rtype === 'grouped_light')?.rid ?? null;
}

export function toRoom(
  dto: RoomDto,
  lightsInRoom: readonly Light[],
  groupedLight: GroupedLightDto | undefined,
): Room {
  const litLights = lightsInRoom.filter((light) => light.isOn);

  // The grouped_light service is authoritative when present; the per-light
  // aggregate is only a fallback for rooms that do not expose one.
  const isOn = groupedLight?.on?.on ?? litLights.length > 0;

  const averageBrightness =
    litLights.length > 0
      ? Math.round(litLights.reduce((sum, light) => sum + light.brightness, 0) / litLights.length)
      : 0;

  return {
    id: dto.id,
    name: dto.metadata.name,
    lightIds: lightsInRoom.map((light) => light.id),
    isOn,
    brightness: groupedLight?.dimming
      ? Math.round(groupedLight.dimming.brightness)
      : averageBrightness,
    supportsGroupControl: groupedLightIdOf(dto) !== null,
  };
}

/** Request bodies for PRD §13, §14, §47, §48. */
/**
 * Scenes belonging to a zone report `group.rtype === 'zone'`. The app models
 * rooms only, so those get a null roomId and are shown in their own section
 * rather than being dropped.
 */
export function toScene(dto: SceneDto): Scene {
  return {
    id: dto.id,
    name: dto.metadata.name,
    roomId: dto.group.rtype === 'room' ? dto.group.rid : null,
    isActive: (dto.status?.active ?? 'inactive') !== 'inactive',
  };
}

export const payloads = {
  power: (on: boolean) => ({ on: { on } }),

  /**
   * 0 % is expressed as "off" because the bridge rejects a zero brightness —
   * without this the slider would silently fail at the bottom of its travel.
   */
  brightness: (percent: number) =>
    percent <= 0
      ? { on: { on: false } }
      : { on: { on: true }, dimming: { brightness: clampBrightness(percent) } },

  temperature: (value: number, schema: MirekSchema) => ({
    color_temperature: { mirek: uiToMirek(value, schema) },
  }),

  color: (color: RgbColor, gamut: Gamut) => ({ color: { xy: rgbToXy(color, gamut) } }),

  /** Applying a scene is a "recall" on the scene resource, not a write to lights. */
  recallScene: () => ({ recall: { action: 'active' } }),
};
