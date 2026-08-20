import { HexColorPicker } from 'react-colorful';

import type { RgbColor } from '../../shared/models';
import { COLOR_PRESETS, hexToRgb, rgbToHex } from '../lib/color';
import { LIGHT_THROTTLE_MS, useThrottledCommit } from '../hooks/useThrottledCommit';

interface ColorPickerProps {
  color: RgbColor | undefined;
  onCommit(color: RgbColor): void;
}

/**
 * Colour selection in plain RGB (PRD §48). The CIE xy conversion and gamut
 * clamping happen in the main process, so this component never learns that the
 * bulb has a colour space of its own.
 */
export function ColorPicker({ color, onCommit }: ColorPickerProps) {
  const hex = color ? rgbToHex(color) : '#ffffff';
  const { throttled, flush } = useThrottledCommit(onCommit, LIGHT_THROTTLE_MS);

  return (
    <div className="space-y-3">
      <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">Kolor</span>

      <div className="flex flex-wrap gap-2">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={`Ustaw kolor ${preset}`}
            onClick={() => flush(hexToRgb(preset))}
            className="h-8 w-8 rounded-full border border-line transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>

      <HexColorPicker
        color={hex}
        onChange={(next) => throttled(hexToRgb(next))}
        style={{ width: '100%' }}
      />
    </div>
  );
}
