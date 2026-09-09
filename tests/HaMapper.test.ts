import { describe, expect, it } from 'vitest';

import {
  brightnessToUi,
  capabilitiesOf,
  kelvinToUi,
  toAutomation,
  toLight,
  toRoom,
  toScene,
  uiToBrightness,
  uiToKelvin,
} from '../src/main/homeassistant/HaMapper';
import { entityStateSchema } from '../src/main/homeassistant/dto';
import {
  HA_COLOR_LIGHT,
  HA_KITCHEN_AREA,
  HA_ONOFF_LIGHT,
  HA_SCENE,
  HA_TEMPERATURE_LIGHT,
} from './fixtures';

const HUB = 'ha-1';

const parse = (raw: unknown) => entityStateSchema.parse(raw);
const colour = parse(HA_COLOR_LIGHT);
const white = parse(HA_TEMPERATURE_LIGHT);
const plain = parse(HA_ONOFF_LIGHT);

const areaByEntity = new Map([
  [colour.entity_id, 'kitchen'],
  [plain.entity_id, 'kitchen'],
]);

describe('brightness', () => {
  it('scales 0-255 onto the percentage the domain model uses', () => {
    expect(brightnessToUi(0)).toBe(0);
    expect(brightnessToUi(255)).toBe(100);
    expect(brightnessToUi(128)).toBe(50);
  });

  it('round-trips a percentage back to what Home Assistant expects', () => {
    for (const value of [0, 25, 50, 75, 100]) {
      expect(brightnessToUi(uiToBrightness(value))).toBe(value);
    }
  });
});

describe('colour temperature', () => {
  /** 0 = warmest, matching the Hue side — kelvin already runs that way. */
  it('puts the warmest end at zero', () => {
    expect(kelvinToUi(2000, 2000, 6500)).toBe(0);
    expect(kelvinToUi(6500, 2000, 6500)).toBe(100);
  });

  it('clamps a reading outside the range the light reports', () => {
    expect(kelvinToUi(1000, 2000, 6500)).toBe(0);
    expect(kelvinToUi(9000, 2000, 6500)).toBe(100);
  });

  it('survives a light that reports one single supported temperature', () => {
    expect(kelvinToUi(4000, 4000, 4000)).toBe(50);
  });

  it('round-trips through the value Home Assistant is sent', () => {
    expect(kelvinToUi(uiToKelvin(30, 2000, 6500), 2000, 6500)).toBe(30);
  });
});

describe('capabilitiesOf', () => {
  it('offers only the controls the light says it supports', () => {
    expect(capabilitiesOf(plain)).toEqual({
      dimming: false,
      colorTemperature: false,
      color: false,
    });
    expect(capabilitiesOf(white)).toEqual({
      dimming: true,
      colorTemperature: true,
      color: false,
    });
  });

  /**
   * An 'hs' light dims but never lists 'brightness' among its modes, so testing
   * for that alone would leave a colour bulb without a brightness slider.
   */
  it('infers dimming from a colour mode that implies it', () => {
    expect(capabilitiesOf(colour)).toEqual({
      dimming: true,
      colorTemperature: true,
      color: true,
    });
  });
});

describe('toLight', () => {
  it('maps the state, brightness and colour a light reports', () => {
    const light = toLight(colour, areaByEntity, HUB);

    expect(light).toMatchObject({
      id: 'light.kitchen_ceiling',
      providerId: HUB,
      name: 'Kitchen Ceiling',
      roomId: 'kitchen',
      isOn: true,
      brightness: 50,
      color: { r: 255, g: 180, b: 90 },
    });
  });

  it('leaves a light in no area ungrouped rather than dropping it', () => {
    expect(toLight(white, areaByEntity, HUB).roomId).toBeNull();
  });

  it('gives a non-dimmable bulb the only two levels it has', () => {
    expect(toLight(plain, areaByEntity, HUB).brightness).toBe(100);
    expect(toLight({ ...plain, state: 'off' }, areaByEntity, HUB).brightness).toBe(0);
  });

  /** Home Assistant reports null brightness while a light is off. */
  it('reads a dimmable light that is off as zero, not as unknown', () => {
    const off = { ...colour, state: 'off', attributes: { ...colour.attributes, brightness: null } };
    expect(toLight(off, areaByEntity, HUB).brightness).toBe(0);
  });

  it('omits the colour while the light is in white mode', () => {
    expect(toLight(white, areaByEntity, HUB).color).toBeUndefined();
    expect(toLight(white, areaByEntity, HUB).colorTemperature).toBe(20);
  });
});

describe('toRoom', () => {
  it('averages the lights that are on, ignoring the ones that are off', () => {
    const lights = [
      toLight(colour, areaByEntity, HUB),
      toLight({ ...plain, state: 'off' }, areaByEntity, HUB),
    ];

    const room = toRoom(HA_KITCHEN_AREA, lights, HUB);

    expect(room).toMatchObject({
      id: 'kitchen',
      providerId: HUB,
      name: 'Kitchen',
      isOn: true,
      brightness: 50,
      // Home Assistant takes an area_id target and fans out itself.
      supportsGroupControl: true,
    });
    expect(room.lightIds).toHaveLength(2);
  });

  it('reports a room with every light off as off', () => {
    const lights = [toLight({ ...colour, state: 'off' }, areaByEntity, HUB)];
    expect(toRoom(HA_KITCHEN_AREA, lights, HUB)).toMatchObject({ isOn: false, brightness: 0 });
  });
});

describe('scenes and automations', () => {
  /** A scene entity's state is when it was last applied, never "on". */
  it('never claims a scene is the one currently showing', () => {
    expect(toScene(parse(HA_SCENE), areaByEntity, HUB).isActive).toBe(false);
  });

  it('reads an automation as enabled from its on/off state', () => {
    const automation = parse({
      entity_id: 'automation.wake_up',
      state: 'on',
      attributes: { friendly_name: 'Wake up' },
    });

    expect(toAutomation(automation, HUB)).toEqual({
      id: 'automation.wake_up',
      providerId: HUB,
      name: 'Wake up',
      enabled: true,
    });
  });

  it('falls back to the entity id when there is no friendly name', () => {
    const nameless = parse({ entity_id: 'automation.x', state: 'off', attributes: {} });
    expect(toAutomation(nameless, HUB).name).toBe('automation.x');
  });
});
