import type { Light, Room } from '../../shared/models';
import { ROOM_THROTTLE_MS } from '../hooks/useThrottledCommit';
import { useSetRoomBrightness, useSetRoomPower } from '../hooks/useHue';
import { lightCountLabel } from '../lib/hue';
import { useUiStore } from '../stores/uiStore';
import { LightCard } from './LightCard';
import { PowerSwitch } from './PowerSwitch';
import { Slider } from './Slider';

interface RoomCardProps {
  room: Room;
  lights: Light[];
}

/**
 * A room and its bulbs (PRD §7, §9).
 *
 * The room is the card and its lights are rows inside it. Giving both the same
 * treatment — as before — made a list of rooms read as one flat pile of boxes.
 */
export function RoomCard({ room, lights }: RoomCardProps) {
  const setPower = useSetRoomPower();
  const setBrightness = useSetRoomBrightness();
  const navigate = useUiStore((state) => state.navigate);

  const onCount = lights.filter((light) => light.isOn).length;

  return (
    <section className="card-stack enter">
      <div className="px-3.5 pt-3.5 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ name: 'room', id: room.id })}
            className="group flex min-w-0 flex-1 items-center gap-1 rounded-row text-left focus-visible:focus-ring"
          >
            <span className="min-w-0">
              <h2 className="truncate text-base font-semibold">{room.name}</h2>
              <span className="text-xs text-ink-muted">
                {lightCountLabel(lights.length)}
                {onCount > 0 && ` · ${onCount} wł.`}
              </span>
            </span>
            <span
              aria-hidden
              className="text-ink-muted transition-transform group-hover:translate-x-0.5"
            >
              ›
            </span>
          </button>
          <PowerSwitch
            checked={room.isOn}
            label={`Przełącz pokój ${room.name}`}
            onCheckedChange={(on) => setPower.mutate({ id: room.id, on })}
          />
        </div>

        {lights.some((light) => light.capabilities.dimming) && (
          <div className="reveal" data-collapsed={!room.isOn} inert={!room.isOn}>
            <div>
              <div className="pt-3">
                <Slider
                  label="Jasność pokoju"
                  value={room.brightness}
                  min={1}
                  throttleMs={ROOM_THROTTLE_MS}
                  onCommit={(brightness) => setBrightness.mutate({ id: room.id, brightness })}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="divide-y divide-line border-t border-line">
        {lights.map((light) => (
          <LightCard key={light.id} light={light} />
        ))}
      </div>
    </section>
  );
}
