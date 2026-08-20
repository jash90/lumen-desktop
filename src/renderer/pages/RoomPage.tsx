import { useLights, useRooms, useSetRoomBrightness, useSetRoomPower } from '../hooks/useHue';
import { LightCard } from '../components/LightCard';
import { Slider } from '../components/Slider';
import { ROOM_THROTTLE_MS } from '../hooks/useThrottledCommit';

/** Whole-room control (PRD §9) — one grouped_light request rather than one per bulb. */
export function RoomPage({ id, connected }: { id: string; connected: boolean }) {
  const rooms = useRooms(connected);
  const lights = useLights(connected);
  const setPower = useSetRoomPower();
  const setBrightness = useSetRoomBrightness();

  const room = rooms.data?.find((candidate) => candidate.id === id);
  if (!room) {
    return <p className="px-6 py-8 text-sm text-ink-muted">Nie znaleziono tego pokoju.</p>;
  }

  const roomLights = (lights.data ?? []).filter((light) => light.roomId === room.id);
  const dimmable = roomLights.some((light) => light.capabilities.dimming);

  return (
    <div className="space-y-6 px-6 py-4">
      <div>
        <h1 className="text-xl font-semibold">{room.name}</h1>
        <p className="text-sm text-ink-muted">
          {roomLights.length === 1 ? '1 lampa' : `${roomLights.length} lamp`}
          {!room.supportsGroupControl && ' · sterowanie pojedynczo'}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setPower.mutate({ id: room.id, on: !room.isOn })}
        className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white"
      >
        {room.isOn ? 'Wyłącz wszystkie' : 'Włącz wszystkie'}
      </button>

      {dimmable && room.isOn && (
        <Slider
          label="Jasność"
          value={room.brightness}
          min={1}
          throttleMs={ROOM_THROTTLE_MS}
          onCommit={(brightness) => setBrightness.mutate({ id: room.id, brightness })}
        />
      )}

      <div className="space-y-1.5">
        {roomLights.map((light) => (
          <LightCard key={light.id} light={light} />
        ))}
      </div>
    </div>
  );
}
