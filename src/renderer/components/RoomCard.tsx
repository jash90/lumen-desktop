import type { Light, Room } from '../../shared/models';
import { ROOM_THROTTLE_MS } from '../hooks/useThrottledCommit';
import { useSetRoomBrightness, useSetRoomPower } from '../hooks/useHue';
import { useUiStore } from '../stores/uiStore';
import { LightCard } from './LightCard';
import { PowerSwitch } from './PowerSwitch';
import { Slider } from './Slider';

const lightCountLabel = (count: number): string => {
  if (count === 1) return '1 lampa';
  // Polish plural: 2–4 (but not 12–14) take a different form from 5+.
  const lastTwo = count % 100;
  const last = count % 10;
  const few = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return `${count} ${few ? 'lampy' : 'lamp'}`;
};

interface RoomCardProps {
  room: Room;
  lights: Light[];
}

/** A room and its bulbs (PRD §7, §9). */
export function RoomCard({ room, lights }: RoomCardProps) {
  const setPower = useSetRoomPower();
  const setBrightness = useSetRoomBrightness();
  const navigate = useUiStore((state) => state.navigate);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3 px-1">
        <button
          type="button"
          onClick={() => navigate({ name: 'room', id: room.id })}
          className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <h2 className="truncate text-base font-semibold">{room.name}</h2>
          <span className="text-xs text-ink-muted">{lightCountLabel(lights.length)}</span>
        </button>
        <PowerSwitch
          checked={room.isOn}
          label={`Przełącz pokój ${room.name}`}
          onCheckedChange={(on) => setPower.mutate({ id: room.id, on })}
        />
      </div>

      {room.isOn && lights.some((light) => light.capabilities.dimming) && (
        <div className="px-1">
          <Slider
            label="Jasność pokoju"
            value={room.brightness}
            min={1}
            throttleMs={ROOM_THROTTLE_MS}
            onCommit={(brightness) => setBrightness.mutate({ id: room.id, brightness })}
          />
        </div>
      )}

      <div className="space-y-1.5">
        {lights.map((light) => (
          <LightCard key={light.id} light={light} />
        ))}
      </div>
    </section>
  );
}
