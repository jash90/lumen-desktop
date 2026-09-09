import { AppError } from '../../shared/errors';
import type { Light, Room } from '../../shared/models';
import type { ChangeSet, LightingApi } from '../providers/LightingProvider';
import { entityStateSchema, type Area, type EntityState } from './dto';
import type { HaClient } from './HaClient';
import {
  domainOf,
  kelvinRangeOf,
  toAutomation,
  toLight,
  toRoom,
  toScene,
  uiToBrightness,
  uiToKelvin,
} from './HaMapper';

/**
 * The Home Assistant implementation of `LightingApi`.
 *
 * Same shape as the Hue one: an in-memory cache of the last known state,
 * synchronous reads, asynchronous writes, and partial updates folded in as the
 * socket delivers them.
 */

export interface HaApiOptions {
  client: HaClient;
  providerId: string;
  /** From the socket's registry call — what turns flat entities into rooms. */
  areas: readonly Area[];
  areaByEntity: ReadonlyMap<string, string>;
}

export function createHaApi(options: HaApiOptions): LightingApi {
  const { client, providerId, areas, areaByEntity } = options;

  const lightEntities = new Map<string, EntityState>();
  const sceneEntities = new Map<string, EntityState>();
  const automationEntities = new Map<string, EntityState>();

  const store = (entity: EntityState): boolean => {
    switch (domainOf(entity.entity_id)) {
      case 'light':
        lightEntities.set(entity.entity_id, entity);
        return true;
      case 'scene':
        sceneEntities.set(entity.entity_id, entity);
        return true;
      case 'automation':
        automationEntities.set(entity.entity_id, entity);
        return true;
      default:
        // Sensors, media players, locks — outside what this app controls.
        return false;
    }
  };

  const projectLight = (entity: EntityState): Light => toLight(entity, areaByEntity, providerId);

  const lightsOf = (areaId: string): Light[] =>
    [...lightEntities.values()]
      .filter((entity) => areaByEntity.get(entity.entity_id) === areaId)
      .map(projectLight);

  const projectRoom = (area: Area): Room => toRoom(area, lightsOf(area.area_id), providerId);

  const requireLight = (id: string): EntityState => {
    const entity = lightEntities.get(id);
    if (!entity) throw new AppError('ResourceUnavailable', `unknown light ${id}`);
    return entity;
  };

  const requireArea = (id: string): Area => {
    const area = areas.find((entry) => entry.area_id === id);
    if (!area) throw new AppError('ResourceUnavailable', `unknown room ${id}`);
    return area;
  };

  /**
   * Home Assistant answers a service call before the device has necessarily
   * acted; the real state arrives over the socket, exactly as the Hue side
   * waits for its event stream rather than guessing.
   */
  const light = (service: 'turn_on' | 'turn_off', id: string, data?: Record<string, unknown>) =>
    client.callService('light', service, { entity_id: id }, data);

  return {
    async refresh() {
      lightEntities.clear();
      sceneEntities.clear();
      automationEntities.clear();
      for (const entity of await client.getStates()) store(entity);
    },

    getLights: () => [...lightEntities.values()].map(projectLight),

    getLight: (id) => projectLight(requireLight(id)),

    // Only areas that actually hold a light: Home Assistant areas also cover
    // rooms with nothing but a thermostat in them, which have no place here.
    getRooms: () =>
      areas
        .map(projectRoom)
        .filter((room) => room.lightIds.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),

    getRoom: (id) => projectRoom(requireArea(id)),

    getScenes: () =>
      [...sceneEntities.values()]
        .map((entity) => toScene(entity, areaByEntity, providerId))
        .sort((a, b) => a.name.localeCompare(b.name)),

    getAutomations: () =>
      [...automationEntities.values()]
        .map((entity) => toAutomation(entity, providerId))
        .sort((a, b) => a.name.localeCompare(b.name)),

    setAutomationEnabled: (id, enabled) =>
      client.callService('automation', enabled ? 'turn_on' : 'turn_off', { entity_id: id }),

    activateScene: (id) => client.callService('scene', 'turn_on', { entity_id: id }),

    setLightPower: (id, on) => light(on ? 'turn_on' : 'turn_off', id),

    setLightBrightness: (id, brightness) =>
      brightness === 0
        ? light('turn_off', id)
        : light('turn_on', id, { brightness: uiToBrightness(brightness) }),

    setLightColor: (id, color) =>
      light('turn_on', id, { rgb_color: [color.r, color.g, color.b] }),

    setLightTemperature: (id, temperature) => {
      const entity = requireLight(id);
      const range = kelvinRangeOf(entity);
      return light('turn_on', id, {
        color_temp_kelvin: uiToKelvin(temperature, range.min, range.max),
      });
    },

    // Targeting the area lets Home Assistant do the fan-out itself, which is one
    // request instead of one per bulb — the same reason the Hue side prefers a
    // grouped_light.
    setRoomPower: (id, on) =>
      client.callService('light', on ? 'turn_on' : 'turn_off', { area_id: requireArea(id).area_id }),

    setRoomBrightness: (id, brightness) => {
      const areaId = requireArea(id).area_id;
      return brightness === 0
        ? client.callService('light', 'turn_off', { area_id: areaId })
        : client.callService(
            'light',
            'turn_on',
            { area_id: areaId },
            { brightness: uiToBrightness(brightness) },
          );
    },

    applyUpdates(updates) {
      const changedRoomIds = new Set<string>();
      const changedLights: Light[] = [];

      for (const update of updates) {
        const parsed = entityStateSchema.safeParse(update);
        // The socket is remote input; a frame we cannot read is skipped rather
        // than thrown out through the connection's callback.
        if (!parsed.success) continue;

        const entity = parsed.data;
        if (!store(entity)) continue;

        if (domainOf(entity.entity_id) === 'light') {
          changedLights.push(projectLight(entity));
          const areaId = areaByEntity.get(entity.entity_id);
          if (areaId) changedRoomIds.add(areaId);
        }
      }

      return {
        lights: changedLights,
        // An area can disappear between the registry read and an event, so a
        // room we can no longer resolve is dropped rather than thrown.
        rooms: [...changedRoomIds].flatMap((id) => {
          const area = areas.find((entry) => entry.area_id === id);
          return area ? [projectRoom(area)] : [];
        }),
      } satisfies ChangeSet;
    },
  };
}
