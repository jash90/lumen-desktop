import { useLights, useRooms, useSetRoomBrightness, useSetRoomPower } from '../hooks/useHue';
import { EmptyState } from '../components/EmptyState';
import { LightCard } from '../components/LightCard';
import { Slider } from '../components/Slider';
import { ROOM_THROTTLE_MS } from '../hooks/useThrottledCommit';
import { lightCountLabel } from '../lib/hue';
import { useUiStore } from '../stores/uiStore';

/** Whole-room control (PRD §9) — one grouped_light request rather than one per bulb. */
export function RoomPage({ id, connected }: { id: string; connected: boolean }) {
  const rooms = useRooms(connected);
  const lights = useLights(connected);
  const setPower = useSetRoomPower();
  const setBrightness = useSetRoomBrightness();

  const goHome = useUiStore((state) => state.goHome);

  const room = rooms.data?.find((candidate) => candidate.id === id);
  if (!room) {
    return (
      <EmptyState
        title="Nie znaleziono tego pokoju"
        description="Mógł zostać usunięty w aplikacji Philips Hue."
        action={{ label: 'Wróć do listy', onClick: goHome }}
      />
    );
  }

  const roomLights = (lights.data ?? []).filter((light) => light.roomId === room.id);
  const dimmable = roomLights.some((light) => light.capabilities.dimming);

  return (
    <div className="space-y-6 px-4 py-4 pb-6">
      <div className="px-1">
        <h1 className="text-lg font-semibold tracking-tight">{room.name}</h1>
        <p className="text-sm text-ink-muted">
          {lightCountLabel(roomLights.length)}
          {!room.supportsGroupControl && ' · sterowanie pojedynczo'}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setPower.mutate({ id: room.id, on: !room.isOn })}
        className="min-h-11 w-full rounded-card bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-105 active:brightness-95 focus-visible:focus-ring"
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

      <div className="card-stack divide-y divide-line">
        {roomLights.map((light) => (
          <LightCard key={light.id} light={light} />
        ))}
      </div>
    </div>
  );
}
