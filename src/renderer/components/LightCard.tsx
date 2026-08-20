import type { Light } from '../../shared/models';
import { LIGHT_THROTTLE_MS } from '../hooks/useThrottledCommit';
import { useSetLightBrightness, useSetLightPower } from '../hooks/useHue';
import { useUiStore } from '../stores/uiStore';
import { PowerSwitch } from './PowerSwitch';
import { Slider } from './Slider';
import { rgbToHex } from '../lib/color';

/**
 * One bulb on the dashboard (PRD §7). The brightness slider is only rendered for
 * bulbs that report a dimming resource — capability-driven UI, per PRD §63.4.
 */
export function LightCard({ light }: { light: Light }) {
  const setPower = useSetLightPower();
  const setBrightness = useSetLightBrightness();
  const navigate = useUiStore((state) => state.navigate);

  const dot = light.isOn ? (light.color ? rgbToHex(light.color) : 'var(--color-accent)') : undefined;

  return (
    <div className="rounded-xl bg-surface-raised px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: dot ?? 'var(--color-line)' }}
        />
        <button
          type="button"
          onClick={() => navigate({ name: 'light', id: light.id })}
          className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <span className="block truncate text-sm font-medium">{light.name}</span>
          <span className="text-xs text-ink-muted">{light.isOn ? 'Włączona' : 'Wyłączona'}</span>
        </button>
        <PowerSwitch
          checked={light.isOn}
          label={`Przełącz ${light.name}`}
          onCheckedChange={(on) => setPower.mutate({ id: light.id, on })}
        />
      </div>

      {light.capabilities.dimming && light.isOn && (
        <div className="mt-3 pl-5.5">
          <Slider
            label="Jasność"
            value={light.brightness}
            min={1}
            throttleMs={LIGHT_THROTTLE_MS}
            onCommit={(brightness) => setBrightness.mutate({ id: light.id, brightness })}
          />
        </div>
      )}
    </div>
  );
}
