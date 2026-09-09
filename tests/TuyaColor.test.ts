import { describe, expect, it } from 'vitest';

import {
  hsvToRgb,
  levelToUi,
  rgbToHsv,
  rgbToTuyaColor,
  tuyaColorToRgb,
  uiToLevel,
} from '../src/main/tuya/TuyaColor';

/**
 * Colour maths only — no device, no socket. The one value read off real
 * hardware is the anchor: the bulb reported `'000003e803e8'` while showing
 * full red, which is what pins the field order and the 0–1000 scales.
 */

describe('levels', () => {
  it('maps a percentage onto what the device stores', () => {
    expect(uiToLevel(100)).toBe(1000);
    expect(uiToLevel(50)).toBe(500);
    expect(levelToUi(500)).toBe(50);
    expect(levelToUi(1000)).toBe(100);
  });

  /**
   * These bulbs reject zero as a brightness — switching off is the power data
   * point's job. Anything at or below the floor clamps to it rather than
   * producing a command the device throws away.
   */
  it('never emits a level below the floor the device accepts', () => {
    expect(uiToLevel(0)).toBe(10);
    expect(uiToLevel(1)).toBe(10);
    expect(uiToLevel(-5)).toBe(10);
  });

  it('clamps a percentage above the top of the range', () => {
    expect(uiToLevel(140)).toBe(1000);
    expect(levelToUi(4000)).toBe(100);
  });

  it('round-trips every step the UI can produce', () => {
    for (let percent = 1; percent <= 100; percent += 1) {
      expect(levelToUi(uiToLevel(percent))).toBe(percent);
    }
  });
});

describe('rgbToHsv', () => {
  it('reads the primaries at the angles they belong to', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toMatchObject({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 }).h).toBe(120);
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBe(240);
  });

  it('gives white no saturation and black no value', () => {
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toMatchObject({ s: 0, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toMatchObject({ s: 0, v: 0 });
  });
});

describe('rgbToTuyaColor', () => {
  /** The exact string the bulb reported while showing red. */
  it('encodes full red as the device does', () => {
    expect(rgbToTuyaColor({ r: 255, g: 0, b: 0 })).toBe('000003e803e8');
  });

  it('packs hue, saturation and value in that order', () => {
    // Pure green: hue 120 = 0x0078, both levels at maximum.
    expect(rgbToTuyaColor({ r: 0, g: 255, b: 0 })).toBe('007803e803e8');
    // Pure blue: hue 240 = 0x00f0.
    expect(rgbToTuyaColor({ r: 0, g: 0, b: 255 })).toBe('00f003e803e8');
  });

  it('always produces twelve hex characters', () => {
    for (const color of [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 1, g: 2, b: 3 },
      { r: 17, g: 200, b: 90 },
    ]) {
      expect(rgbToTuyaColor(color)).toMatch(/^[0-9a-f]{12}$/);
    }
  });
});

describe('tuyaColorToRgb', () => {
  it('reads back what the device reported as red', () => {
    expect(tuyaColorToRgb('000003e803e8')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('round-trips a spread of colours within rounding', () => {
    for (const color of [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 180, b: 90 },
      { r: 12, g: 200, b: 240 },
      { r: 255, g: 255, b: 255 },
    ]) {
      const back = tuyaColorToRgb(rgbToTuyaColor(color));
      expect(back).not.toBeNull();
      // Hue is stored in whole degrees, so a channel can shift by a little.
      expect(Math.abs(back!.r - color.r)).toBeLessThanOrEqual(3);
      expect(Math.abs(back!.g - color.g)).toBeLessThanOrEqual(3);
      expect(Math.abs(back!.b - color.b)).toBeLessThanOrEqual(3);
    }
  });

  /** The device is remote input: a malformed value must not throw. */
  it('returns null for anything that is not the expected shape', () => {
    for (const bad of ['', 'nope', '000003e803', '000003e803e8ff', 'zzzz03e803e8']) {
      expect(tuyaColorToRgb(bad)).toBeNull();
    }
  });
});

describe('hsvToRgb', () => {
  it('wraps a hue outside the circle instead of clipping it', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('clamps saturation and value rather than producing an impossible channel', () => {
    expect(hsvToRgb({ h: 0, s: 5, v: 5 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 0, s: -1, v: -1 })).toEqual({ r: 0, g: 0, b: 0 });
  });
});
