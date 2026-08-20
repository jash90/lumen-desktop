import { HueError } from '../../shared/errors';
import type { Light, RgbColor, Room } from '../../shared/models';
import {
  groupedLightDtoSchema,
  lightDtoSchema,
  roomDtoSchema,
  type GroupedLightDto,
  type LightDto,
  type RoomDto,
} from './dto';
import type { HueClient } from './HueClient';
import {
  buildRoomIndex,
  gamutOf,
  groupedLightIdOf,
  mirekSchemaOf,
  payloads,
  toLight,
  toRoom,
} from './HueMapper';

/**
 * Domain operations over the Hue resources (PRD §43).
 *
 * Holds the last known resource state because three things need it: the
 * light→room join, translating partial event-stream updates into full domain
 * objects, and resolving a bulb's own mirek range before writing a colour
 * temperature. Without the cache each of those would cost an extra round trip.
 */
export interface HueApi {
  refresh(): Promise<void>;
  getLights(): Light[];
  getLight(id: string): Light;
  getRooms(): Room[];
  getRoom(id: string): Room;
  setLightPower(id: string, on: boolean): Promise<void>;
  setLightBrightness(id: string, brightness: number): Promise<void>;
  setLightColor(id: string, color: RgbColor): Promise<void>;
  setLightTemperature(id: string, temperature: number): Promise<void>;
  setRoomPower(id: string, on: boolean): Promise<void>;
  setRoomBrightness(id: string, brightness: number): Promise<void>;
  /** Applies partial resource updates from the event stream; returns what changed. */
  applyUpdates(updates: readonly UnknownResource[]): ChangeSet;
}

export interface UnknownResource {
  id: string;
  type?: string;
  [key: string]: unknown;
}

export interface ChangeSet {
  lights: Light[];
  rooms: Room[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Event-stream updates are partial: a brightness change sends `dimming` with only
 * `brightness` in it. A shallow merge would drop `mirek_schema` and break the
 * temperature slider, so nested objects are merged one level deep.
 */
function mergeResource<T extends object>(base: T, update: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(update)) {
    const current = merged[key];
    merged[key] =
      isPlainObject(value) && isPlainObject(current) ? { ...current, ...value } : value;
  }
  return merged as T;
}

export function createHueApi(client: HueClient): HueApi {
  const lightDtos = new Map<string, LightDto>();
  const roomDtos = new Map<string, RoomDto>();
  const groupedLightDtos = new Map<string, GroupedLightDto>();
  /** device rid -> room id */
  let roomIndex = new Map<string, string>();

  const roomIdOfGroupedLight = (groupedLightId: string): string | undefined => {
    for (const room of roomDtos.values()) {
      if (groupedLightIdOf(room) === groupedLightId) return room.id;
    }
    return undefined;
  };

  const projectLight = (dto: LightDto): Light => toLight(dto, roomIndex);

  const projectRoom = (dto: RoomDto): Room => {
    const lightsInRoom = [...lightDtos.values()]
      .filter((light) => roomIndex.get(light.owner.rid) === dto.id)
      .map(projectLight);
    const groupedLightId = groupedLightIdOf(dto);
    const groupedLight = groupedLightId ? groupedLightDtos.get(groupedLightId) : undefined;
    return toRoom(dto, lightsInRoom, groupedLight);
  };

  const requireLightDto = (id: string): LightDto => {
    const dto = lightDtos.get(id);
    if (!dto) throw new HueError('RequestFailed', `unknown light ${id}`);
    return dto;
  };

  const requireRoomDto = (id: string): RoomDto => {
    const dto = roomDtos.get(id);
    if (!dto) throw new HueError('RequestFailed', `unknown room ${id}`);
    return dto;
  };

  /**
   * Falls back to per-light commands for rooms without a grouped_light service.
   * Using the group resource is the whole point of PRD §49 — one request instead
   * of one per bulb — but a handful of rooms genuinely lack it.
   */
  async function writeRoom(id: string, body: object, perLight: (lightId: string) => Promise<void>) {
    const groupedLightId = groupedLightIdOf(requireRoomDto(id));
    if (groupedLightId) {
      await client.update('grouped_light', groupedLightId, body);
      return;
    }
    const lightIds = projectRoom(requireRoomDto(id)).lightIds;
    await Promise.all(lightIds.map(perLight));
  }

  return {
    async refresh() {
      const [lights, rooms, groupedLights] = await Promise.all([
        client.list('light', lightDtoSchema),
        client.list('room', roomDtoSchema),
        client.list('grouped_light', groupedLightDtoSchema),
      ]);

      lightDtos.clear();
      roomDtos.clear();
      groupedLightDtos.clear();
      for (const light of lights) lightDtos.set(light.id, light);
      for (const room of rooms) roomDtos.set(room.id, room);
      for (const groupedLight of groupedLights) groupedLightDtos.set(groupedLight.id, groupedLight);
      roomIndex = buildRoomIndex(rooms);
    },

    getLights: () => [...lightDtos.values()].map(projectLight),
    getLight: (id) => projectLight(requireLightDto(id)),

    getRooms: () =>
      [...roomDtos.values()]
        .map(projectRoom)
        .sort((a, b) => a.name.localeCompare(b.name)),

    getRoom: (id) => projectRoom(requireRoomDto(id)),

    setLightPower: (id, on) => client.update('light', id, payloads.power(on)),

    async setLightBrightness(id, brightness) {
      const dto = requireLightDto(id);
      if (!dto.dimming) throw new HueError('UnsupportedCapability', `light ${id} cannot dim`);
      return client.update('light', id, payloads.brightness(brightness));
    },

    async setLightColor(id, color) {
      const dto = requireLightDto(id);
      if (!dto.color) throw new HueError('UnsupportedCapability', `light ${id} has no colour`);
      return client.update('light', id, payloads.color(color, gamutOf(dto)));
    },

    async setLightTemperature(id, temperature) {
      const dto = requireLightDto(id);
      if (!dto.color_temperature) {
        throw new HueError('UnsupportedCapability', `light ${id} has no colour temperature`);
      }
      return client.update('light', id, payloads.temperature(temperature, mirekSchemaOf(dto)));
    },

    async setRoomPower(id, on) {
      return writeRoom(id, payloads.power(on), (lightId) =>
        client.update('light', lightId, payloads.power(on)),
      );
    },

    async setRoomBrightness(id, brightness) {
      return writeRoom(id, payloads.brightness(brightness), (lightId) =>
        client.update('light', lightId, payloads.brightness(brightness)),
      );
    },

    applyUpdates(updates) {
      const changedLightIds = new Set<string>();
      const changedRoomIds = new Set<string>();

      for (const update of updates) {
        const { id, type } = update;
        if (type === 'light' && lightDtos.has(id)) {
          lightDtos.set(id, mergeResource(lightDtos.get(id)!, update));
          changedLightIds.add(id);
          const roomId = roomIndex.get(lightDtos.get(id)!.owner.rid);
          if (roomId) changedRoomIds.add(roomId);
        } else if (type === 'grouped_light' && groupedLightDtos.has(id)) {
          groupedLightDtos.set(id, mergeResource(groupedLightDtos.get(id)!, update));
          const roomId = roomIdOfGroupedLight(id);
          if (roomId) changedRoomIds.add(roomId);
        }
        // Other resource types (sensors, zigbee_connectivity, …) are outside MVP scope.
      }

      return {
        lights: [...changedLightIds].map((id) => projectLight(lightDtos.get(id)!)),
        rooms: [...changedRoomIds]
          .filter((id) => roomDtos.has(id))
          .map((id) => projectRoom(roomDtos.get(id)!)),
      };
    },
  };
}
