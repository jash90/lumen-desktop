import * as RadixSlider from '@radix-ui/react-slider';
import { useEffect, useState } from 'react';

import { useThrottledCommit } from '../hooks/useThrottledCommit';

interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** Milliseconds between network writes while dragging. */
  throttleMs: number;
  onCommit(value: number): void;
  /** Rendered behind the track — used for the warm→cold and colour gradients. */
  trackGradient?: string;
  formatValue?(value: number): string;
}

/**
 * One slider for brightness and colour temperature. Radix gives keyboard and
 * screen-reader behaviour for free, which a div with a drag handler would not.
 */
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  disabled = false,
  throttleMs,
  onCommit,
  trackGradient,
  formatValue = (v) => `${v}%`,
}: SliderProps) {
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  const { throttled, flush } = useThrottledCommit(onCommit, throttleMs);

  // While dragging, the local value wins — otherwise an in-flight echo from the
  // bridge would yank the handle back under the user's finger.
  useEffect(() => {
    if (!dragging) setLocal(value);
  }, [value, dragging]);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</span>
        <span className="text-xs tabular-nums text-ink-muted">{formatValue(local)}</span>
      </div>
      <RadixSlider.Root
        className="relative flex h-6 w-full touch-none items-center select-none data-disabled:opacity-40"
        value={[local]}
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        aria-label={label}
        onValueChange={([next]) => {
          if (next === undefined) return;
          setDragging(true);
          setLocal(next);
          throttled(next);
        }}
        onValueCommit={([next]) => {
          if (next === undefined) return;
          setDragging(false);
          flush(next);
        }}
      >
        <RadixSlider.Track
          className="relative h-2 w-full grow overflow-hidden rounded-full bg-line"
          style={trackGradient ? { backgroundImage: trackGradient } : undefined}
        >
          {!trackGradient && <RadixSlider.Range className="absolute h-full bg-accent" />}
        </RadixSlider.Track>
        <RadixSlider.Thumb className="block h-5 w-5 rounded-full border-2 border-white bg-accent shadow-md ring-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      </RadixSlider.Root>
    </div>
  );
}
