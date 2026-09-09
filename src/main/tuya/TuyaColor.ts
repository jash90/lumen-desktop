import type { RgbColor } from '../../shared/models';

/**
 * Colour and level conversion for Tuya "type B" bulbs (data points 20–27).
 *
 * Nothing here is reusable from the Hue side: `HueColor` converts sRGB to CIE xy
 * against a Signify gamut, while Tuya wants HSV packed into a hex string. The
 * only thing the two share is the domain model's `RgbColor`.
 *
 * Ranges below are not guesses — they were read off the bulb on this network:
 *
 *   {'20': false, '21': 'white', '22': 140, '23': 0, '24': '000003e803e8', ...}
 *
 * `'000003e803e8'` is hue 0x0000, saturation 0x03e8 and value 0x03e8 — full-blown
 * red at 1000/1000, which is what fixes the field widths and the scales.
 */

/** Brightness and colour temperature both run 10–1000 on these devices. */
export const TUYA_LEVEL_MIN = 10;
export const TUYA_LEVEL_MAX = 1000;

export interface Hsv {
  /** 0–360 degrees. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  v: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * A percentage from the domain model to what the device stores.
 *
 * The floor matters: these bulbs reject 0 as a brightness, so switching off is
 * the power data point's job, never a level of zero.
 */
export function uiToLevel(percent: number): number {
  return clamp(Math.round(clamp(percent, 0, 100) * 10), TUYA_LEVEL_MIN, TUYA_LEVEL_MAX);
}

export function levelToUi(level: number): number {
  return clamp(Math.round(level / 10), 0, 100);
}

export function rgbToHsv(color: RgbColor): Hsv {
  const r = clamp(color.r, 0, 255) / 255;
  const g = clamp(color.g, 0, 255) / 255;
  const b = clamp(color.b, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(hsv: Hsv): RgbColor {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 1);
  const v = clamp(hsv.v, 0, 1);

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];

  const channel = (value: number): number => Math.round((value + m) * 255);
  return { r: channel(r!), g: channel(g!), b: channel(b!) };
}

const hex4 = (value: number): string => Math.round(value).toString(16).padStart(4, '0');

/**
 * Packs a colour into the twelve-character `HHHHSSSSVVVV` the device stores:
 * hue in degrees, saturation and value both 0–1000, each as four hex digits.
 */
export function rgbToTuyaColor(color: RgbColor): string {
  const { h, s, v } = rgbToHsv(color);
  return (
    hex4(clamp(h, 0, 360)) +
    hex4(clamp(s * TUYA_LEVEL_MAX, 0, TUYA_LEVEL_MAX)) +
    hex4(clamp(v * TUYA_LEVEL_MAX, 0, TUYA_LEVEL_MAX))
  );
}

/** Inverse of {@link rgbToTuyaColor}; null for anything that is not that shape. */
export function tuyaColorToRgb(value: string): RgbColor | null {
  if (!/^[0-9a-fA-F]{12}$/.test(value)) return null;

  const h = parseInt(value.slice(0, 4), 16);
  const s = parseInt(value.slice(4, 8), 16);
  const v = parseInt(value.slice(8, 12), 16);

  return hsvToRgb({ h, s: s / TUYA_LEVEL_MAX, v: v / TUYA_LEVEL_MAX });
}
