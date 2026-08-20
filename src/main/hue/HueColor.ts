import type { RgbColor } from '../../shared/models';

/**
 * Conversion between sRGB and the CIE xy space the Hue bridge speaks (PRD §48).
 *
 * Kept out of React entirely: the renderer hands over plain RGB and never learns
 * that xy, gamuts or Wide-RGB primaries exist.
 */

export interface XyColor {
  x: number;
  y: number;
}

export interface Gamut {
  red: XyColor;
  green: XyColor;
  blue: XyColor;
}

/**
 * Gamut C — the widest of the three Hue gamuts, used by current colour bulbs.
 * Only a fallback: every light reports its own gamut and that one wins.
 */
export const DEFAULT_GAMUT: Gamut = {
  red: { x: 0.6915, y: 0.3083 },
  green: { x: 0.17, y: 0.7 },
  blue: { x: 0.1532, y: 0.0475 },
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** sRGB transfer function and its inverse. */
const toLinear = (channel: number): number =>
  channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92;

const fromLinear = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

const distance = (a: XyColor, b: XyColor): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Nearest point to `p` on the segment ab, used to pull a colour onto the gamut edge. */
function closestPointOnSegment(a: XyColor, b: XyColor, p: XyColor): XyColor {
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLengthSquared = abx * abx + aby * aby;
  if (abLengthSquared === 0) return a;
  const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / abLengthSquared));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

function isInsideGamut(point: XyColor, gamut: Gamut): boolean {
  const { red, green, blue } = gamut;
  const cross = (o: XyColor, a: XyColor, b: XyColor): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const d1 = cross(red, green, point);
  const d2 = cross(green, blue, point);
  const d3 = cross(blue, red, point);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  // Consistent winding on all three edges means the point is inside the triangle.
  return !(hasNegative && hasPositive);
}

/** Colours outside a bulb's gamut are physically unreachable; snap to the nearest one it can show. */
export function clampToGamut(point: XyColor, gamut: Gamut): XyColor {
  if (isInsideGamut(point, gamut)) return point;

  const candidates = [
    closestPointOnSegment(gamut.red, gamut.green, point),
    closestPointOnSegment(gamut.green, gamut.blue, point),
    closestPointOnSegment(gamut.blue, gamut.red, point),
  ];

  return candidates.reduce((best, candidate) =>
    distance(candidate, point) < distance(best, point) ? candidate : best,
  );
}

export function rgbToXy(color: RgbColor, gamut: Gamut = DEFAULT_GAMUT): XyColor {
  const r = toLinear(clamp01(color.r / 255));
  const g = toLinear(clamp01(color.g / 255));
  const b = toLinear(clamp01(color.b / 255));

  // Wide-RGB D65 primaries, as published by Signify for the Hue lamps.
  const X = r * 0.649926 + g * 0.103455 + b * 0.197109;
  const Y = r * 0.234327 + g * 0.743075 + b * 0.022598;
  const Z = g * 0.053077 + b * 1.035763;

  const sum = X + Y + Z;
  // Pure black carries no chromaticity — fall back to the gamut's red corner so
  // the bridge still receives a valid coordinate.
  if (sum === 0) return clampToGamut({ x: gamut.red.x, y: gamut.red.y }, gamut);

  return clampToGamut({ x: X / sum, y: Y / sum }, gamut);
}

/**
 * `brightness` is 0–1 and only scales the result; the bridge stores brightness
 * separately, so the swatch shown in the UI normally uses full brightness.
 */
export function xyToRgb(point: XyColor, brightness = 1): RgbColor {
  const y = point.y === 0 ? 1e-6 : point.y;
  const Y = clamp01(brightness);
  const X = (Y / y) * point.x;
  const Z = (Y / y) * (1 - point.x - point.y);

  let r = X * 1.612 - Y * 0.203 - Z * 0.302;
  let g = -X * 0.509 + Y * 1.412 + Z * 0.066;
  let b = X * 0.026 - Y * 0.072 + Z * 0.962;

  r = fromLinear(Math.max(0, r));
  g = fromLinear(Math.max(0, g));
  b = fromLinear(Math.max(0, b));

  // Out-of-range channels mean the colour is brighter than sRGB can show; scale
  // the whole triple down so the hue is preserved instead of clipping one channel.
  const max = Math.max(r, g, b);
  if (max > 1) {
    r /= max;
    g /= max;
    b /= max;
  }

  return {
    r: Math.round(clamp01(r) * 255),
    g: Math.round(clamp01(g) * 255),
    b: Math.round(clamp01(b) * 255),
  };
}
