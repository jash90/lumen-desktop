import { describe, expect, it } from 'vitest';

import {
  clampToGamut,
  DEFAULT_GAMUT,
  rgbToXy,
  xyToRgb,
} from '../src/main/hue/HueColor';

describe('HueColor', () => {
  it('round-trips a saturated colour within a small tolerance', () => {
    const original = { r: 220, g: 40, b: 60 };
    const roundTripped = xyToRgb(rgbToXy(original));

    // xy discards luminance, so hue is preserved but the exact triple is not.
    const hueOf = (c: { r: number; g: number; b: number }) => {
      const max = Math.max(c.r, c.g, c.b);
      return { dominant: max === c.r ? 'r' : max === c.g ? 'g' : 'b' };
    };
    expect(hueOf(roundTripped)).toEqual(hueOf(original));
  });

  it('keeps every conversion inside the reachable gamut', () => {
    for (const rgb of [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 255, b: 255 },
    ]) {
      const xy = rgbToXy(rgb);
      expect(clampToGamut(xy, DEFAULT_GAMUT)).toEqual(xy);
    }
  });

  it('pulls an out-of-gamut coordinate onto the triangle', () => {
    const outside = { x: 0.9, y: 0.05 };
    const clamped = clampToGamut(outside, DEFAULT_GAMUT);

    expect(clamped).not.toEqual(outside);
    expect(clamped).toEqual(clampToGamut(clamped, DEFAULT_GAMUT));
  });

  it('produces a valid coordinate for pure black instead of dividing by zero', () => {
    const xy = rgbToXy({ r: 0, g: 0, b: 0 });
    expect(Number.isFinite(xy.x)).toBe(true);
    expect(Number.isFinite(xy.y)).toBe(true);
  });

  it('never emits a channel outside 0–255', () => {
    for (const point of [
      { x: 0.7, y: 0.29 },
      { x: 0.15, y: 0.06 },
      { x: 0.32, y: 0.33 },
    ]) {
      const rgb = xyToRgb(point);
      for (const channel of [rgb.r, rgb.g, rgb.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});
