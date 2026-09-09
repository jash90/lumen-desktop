import type { Light, Room } from '../../shared/models';
import { ROOM_THROTTLE_MS } from '../hooks/useThrottledCommit';
import { useHubLabels, useSetRoomBrightness, useSetRoomPower } from '../hooks/useLighting';
import { lightCountLabel } from '../lib/api';
import { useUiStore } from '../stores/uiStore';
import { FavoriteButton } from './FavoriteButton';
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
  // Empty unless more than one hub is connected, so a single-hub house sees no
  // labelling it does not need.
  const hubName = useHubLabels().get(room.providerId);

  const onCount = lights.filter((light) => light.isOn).length;

  return (
    <section className="card-stack enter">
      <div className="group/row px-3.5 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate({ name: 'room', id: room.id })}
            className="group/link flex min-w-0 flex-1 items-center gap-1 rounded-row text-left focus-visible:focus-ring"
          >
            <span className="min-w-0">
              <h2 className="truncate text-base font-semibold">{room.name}</h2>
              <span className="text-xs text-ink-muted">
                {lightCountLabel(lights.length)}
                {onCount > 0 && ` · ${onCount} on`}
                {hubName && ` · ${hubName}`}
              </span>
            </span>
            <span
              aria-hidden
              className="text-ink-muted transition-transform group-hover/link:translate-x-0.5"
            >
              ›
            </span>
          </button>
          <FavoriteButton target={{ type: 'room', id: room.id }} label={`room ${room.name}`} />
          <PowerSwitch
            checked={room.isOn}
            label={`Toggle room ${room.name}`}
            onCheckedChange={(on) => setPower.mutate({ id: room.id, on })}
          />
        </div>

        {lights.some((light) => light.capabilities.dimming) && (
          <div className="reveal" data-collapsed={!room.isOn} inert={!room.isOn}>
            <div>
              <div className="pt-3">
                <Slider
                  label="Room brightness"
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
