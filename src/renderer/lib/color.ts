import type { RgbColor } from '../../shared/models';

const toHexPair = (value: number) => value.toString(16).padStart(2, '0');

export const rgbToHex = ({ r, g, b }: RgbColor): string =>
  `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;

export function hexToRgb(hex: string): RgbColor {
  const normalised = hex.replace('#', '');
  return {
    r: Number.parseInt(normalised.slice(0, 2), 16) || 0,
    g: Number.parseInt(normalised.slice(2, 4), 16) || 0,
    b: Number.parseInt(normalised.slice(4, 6), 16) || 0,
  };
}

/** The swatch row from PRD §8. */
export const COLOR_PRESETS: readonly string[] = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#0a84ff',
  '#af52de',
  '#ff2d95',
  '#ffffff',
];
