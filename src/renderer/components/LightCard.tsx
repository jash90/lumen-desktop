import type { CSSProperties } from 'react';

import type { Light } from '../../shared/models';
import { LIGHT_THROTTLE_MS } from '../hooks/useThrottledCommit';
import { useSetLightBrightness, useSetLightPower } from '../hooks/useHue';
import { useUiStore } from '../stores/uiStore';
import { PowerSwitch } from './PowerSwitch';
import { Slider } from './Slider';
import { rgbToHex } from '../lib/color';

/**
 * One bulb, rendered as a flat row inside a room card — the card is the only
 * raised surface, which is what keeps rooms and lights visually apart.
 *
 * The brightness slider only exists for bulbs reporting a dimming resource
 * (capability-driven UI, PRD §63.4).
 */
export function LightCard({ light }: { light: Light }) {
  const setPower = useSetLightPower();
  const setBrightness = useSetLightBrightness();
  const navigate = useUiStore((state) => state.navigate);

  const tint = light.color ? rgbToHex(light.color) : 'var(--color-accent)';

  return (
    <div className="enter px-3.5 py-3" style={{ '--light': tint } as CSSProperties}>
      <div className="flex items-center gap-3">
        {/* One mechanism carries hue, on/off and glow — a 10px dot could not. */}
        <span
          aria-hidden
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-all duration-300 ${
            light.isOn
              ? 'bg-[color-mix(in_oklab,var(--light)_22%,transparent)] shadow-[0_0_12px_-2px_var(--light)]'
              : 'bg-transparent ring-1 ring-line ring-inset'
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
              light.isOn ? 'bg-[var(--light)]' : 'bg-line'
            }`}
          />
        </span>

        <button
          type="button"
          onClick={() => navigate({ name: 'light', id: light.id })}
          className="min-w-0 flex-1 rounded-row py-0.5 text-left focus-visible:focus-ring"
        >
          <span
            className={`block truncate text-sm font-medium transition-colors ${
              light.isOn ? 'text-ink' : 'text-ink-muted'
            }`}
          >
            {light.name}
          </span>
          <span className="text-xs tabular-nums text-ink-muted">
            {light.isOn
              ? light.capabilities.dimming
                ? `${light.brightness}%`
                : 'Włączona'
              : 'Wyłączona'}
          </span>
        </button>

        <PowerSwitch
          checked={light.isOn}
          label={`Przełącz ${light.name}`}
          onCheckedChange={(on) => setPower.mutate({ id: light.id, on })}
        />
      </div>

      {/* Kept mounted so the reveal animates both ways; inert while collapsed
          keeps it out of the tab order and off the accessibility tree. */}
      {light.capabilities.dimming && (
        <div className="reveal" data-collapsed={!light.isOn} inert={!light.isOn}>
          <div>
            <div className="pt-3 pl-10">
              <Slider
                label="Jasność"
                value={light.brightness}
                min={1}
                throttleMs={LIGHT_THROTTLE_MS}
                onCommit={(brightness) => setBrightness.mutate({ id: light.id, brightness })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
