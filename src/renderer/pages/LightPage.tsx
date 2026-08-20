import { useLights, useSetLightBrightness, useSetLightColor, useSetLightPower, useSetLightTemperature } from '../hooks/useHue';
import { ColorPicker } from '../components/ColorPicker';
import { PowerSwitch } from '../components/PowerSwitch';
import { Slider } from '../components/Slider';
import { LIGHT_THROTTLE_MS } from '../hooks/useThrottledCommit';

/**
 * Single bulb detail (PRD §8).
 *
 * Which controls appear is decided entirely by what the bulb reports: a white
 * bulb gets on/off and brightness, an ambiance bulb adds temperature, a colour
 * bulb adds the picker (PRD §63.4).
 */
export function LightPage({ id, connected }: { id: string; connected: boolean }) {
  const lights = useLights(connected);
  const setPower = useSetLightPower();
  const setBrightness = useSetLightBrightness();
  const setTemperature = useSetLightTemperature();
  const setColor = useSetLightColor();

  const light = lights.data?.find((candidate) => candidate.id === id);

  if (!light) {
    return <p className="px-6 py-8 text-sm text-ink-muted">Nie znaleziono tej lampy.</p>;
  }

  return (
    <div className="space-y-7 px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="truncate text-xl font-semibold">{light.name}</h1>
        <PowerSwitch
          checked={light.isOn}
          label={`Przełącz ${light.name}`}
          onCheckedChange={(on) => setPower.mutate({ id: light.id, on })}
        />
      </div>

      {light.capabilities.dimming && (
        <Slider
          label="Jasność"
          value={light.brightness}
          min={1}
          disabled={!light.isOn}
          throttleMs={LIGHT_THROTTLE_MS}
          onCommit={(brightness) => setBrightness.mutate({ id: light.id, brightness })}
        />
      )}

      {light.capabilities.colorTemperature && (
        <Slider
          label="Temperatura barwowa"
          value={light.colorTemperature ?? 50}
          disabled={!light.isOn}
          throttleMs={LIGHT_THROTTLE_MS}
          trackGradient="linear-gradient(90deg,#ffb46b,#fff5e8,#cfe4ff)"
          formatValue={(value) => (value < 34 ? 'Ciepła' : value > 66 ? 'Zimna' : 'Neutralna')}
          onCommit={(temperature) => setTemperature.mutate({ id: light.id, temperature })}
        />
      )}

      {light.capabilities.color && (
        <ColorPicker
          color={light.color}
          onCommit={(color) => setColor.mutate({ id: light.id, color })}
        />
      )}

      {!light.capabilities.dimming &&
        !light.capabilities.colorTemperature &&
        !light.capabilities.color && (
          <p className="text-sm text-ink-muted">Ta lampa obsługuje wyłącznie włącz/wyłącz.</p>
        )}
    </div>
  );
}
