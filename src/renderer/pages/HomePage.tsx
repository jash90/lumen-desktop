import { useLights, useRooms } from '../hooks/useHue';
import { LightCard } from '../components/LightCard';
import { RoomCard } from '../components/RoomCard';

/** The dashboard from PRD §7: rooms, each with its lights. */
export function HomePage({ connected }: { connected: boolean }) {
  const rooms = useRooms(connected);
  const lights = useLights(connected);

  if (rooms.isLoading || lights.isLoading) {
    return <p className="px-6 py-8 text-sm text-ink-muted">Wczytywanie…</p>;
  }

  const allLights = lights.data ?? [];
  const ungrouped = allLights.filter((light) => light.roomId === null);

  if (allLights.length === 0) {
    return (
      <p className="px-6 py-8 text-sm text-ink-muted">
        Nie znaleziono żadnych lamp na tym Hue Bridge.
      </p>
    );
  }

  return (
    <div className="space-y-6 px-4 py-4">
      {(rooms.data ?? []).map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          lights={allLights.filter((light) => light.roomId === room.id)}
        />
      ))}

      {ungrouped.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-base font-semibold">Poza pokojami</h2>
          <div className="space-y-1.5">
            {ungrouped.map((light) => (
              <LightCard key={light.id} light={light} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
