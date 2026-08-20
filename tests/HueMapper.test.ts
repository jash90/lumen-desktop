import { describe, expect, it } from 'vitest';

import {
  buildRoomIndex,
  clampBrightness,
  capabilitiesOf,
  groupedLightIdOf,
  mirekToUi,
  payloads,
  toLight,
  toRoom,
  uiToMirek,
} from '../src/main/hue/HueMapper';
import { lightDtoSchema, roomDtoSchema } from '../src/main/hue/dto';
import { CEILING_LIGHT, LIVING_ROOM, LIVING_ROOM_GROUP, PLAIN_LIGHT } from './fixtures';

const ceiling = lightDtoSchema.parse(CEILING_LIGHT);
const plain = lightDtoSchema.parse(PLAIN_LIGHT);
const room = roomDtoSchema.parse(LIVING_ROOM);

describe('brightness', () => {
  it('clamps to the range the bridge accepts', () => {
    // 0 is rejected by the bridge; "off" is a separate property.
    expect(clampBrightness(0)).toBe(1);
    expect(clampBrightness(-20)).toBe(1);
    expect(clampBrightness(180)).toBe(100);
    expect(clampBrightness(72.4)).toBe(72);
  });

  it('turns the light off at 0 % instead of sending an invalid level', () => {
    expect(payloads.brightness(0)).toEqual({ on: { on: false } });
    expect(payloads.brightness(72)).toEqual({ on: { on: true }, dimming: { brightness: 72 } });
  });
});

describe('colour temperature', () => {
  const schema = { mirek_minimum: 153, mirek_maximum: 500 };

  it('maps mirek to a warm→cold percentage', () => {
    expect(mirekToUi(500, schema)).toBe(0); // warmest
    expect(mirekToUi(153, schema)).toBe(100); // coldest
    expect(mirekToUi(326, schema)).toBe(50);
  });

  it('round-trips through the UI domain', () => {
    for (const mirek of [153, 200, 326, 400, 500]) {
      expect(uiToMirek(mirekToUi(mirek, schema), schema)).toBeCloseTo(mirek, -1);
    }
  });

  it('respects a bulb-specific range rather than assuming 153–500', () => {
    const narrow = { mirek_minimum: 250, mirek_maximum: 454 };
    expect(uiToMirek(0, narrow)).toBe(454);
    expect(uiToMirek(100, narrow)).toBe(250);
  });

  it('builds the payload the bridge expects', () => {
    expect(payloads.temperature(100, schema)).toEqual({ color_temperature: { mirek: 153 } });
  });
});

describe('capabilities', () => {
  it('offers a control only when the bulb reports the resource', () => {
    expect(capabilitiesOf(ceiling)).toEqual({ dimming: true, colorTemperature: true, color: true });
    expect(capabilitiesOf(plain)).toEqual({
      dimming: false,
      colorTemperature: false,
      color: false,
    });
  });
});

describe('toLight', () => {
  const index = buildRoomIndex([room]);

  it('joins a light to its room through the owning device', () => {
    expect(toLight(ceiling, index).roomId).toBe('room-living');
  });

  it('reports no room for a light outside every room', () => {
    expect(toLight(ceiling, new Map()).roomId).toBeNull();
  });

  it('gives a non-dimmable bulb the only two levels it has', () => {
    expect(toLight(plain, index).brightness).toBe(0);
    expect(toLight({ ...plain, on: { on: true } }, index).brightness).toBe(100);
  });

  it('omits colour temperature while the bulb is showing a colour', () => {
    const inColourMode = { ...ceiling, color_temperature: { ...ceiling.color_temperature, mirek: null } };
    expect(toLight(inColourMode, index).colorTemperature).toBeUndefined();
    expect(toLight(inColourMode, index).capabilities.colorTemperature).toBe(true);
  });
});

describe('toRoom', () => {
  it('prefers the grouped_light state over the per-light aggregate', () => {
    const lights = [toLight(plain, buildRoomIndex([room]))];
    const mapped = toRoom(room, lights, LIVING_ROOM_GROUP);

    expect(mapped.isOn).toBe(true); // group says on, though its only light is off
    expect(mapped.brightness).toBe(65);
    expect(mapped.supportsGroupControl).toBe(true);
  });

  it('falls back to the member lights when there is no group service', () => {
    const index = buildRoomIndex([room]);
    const lights = [toLight(ceiling, index), toLight(plain, index)];
    const roomWithoutGroup = { ...room, services: [] };

    const mapped = toRoom(roomWithoutGroup, lights, undefined);
    expect(mapped.isOn).toBe(true);
    expect(mapped.brightness).toBe(72); // only the lit bulb counts
    expect(mapped.supportsGroupControl).toBe(false);
  });

  it('finds the grouped_light service among other services', () => {
    expect(groupedLightIdOf(room)).toBe('grouped-living');
    expect(groupedLightIdOf({ ...room, services: [] })).toBeNull();
  });
});
