import { useLights, useRooms, useScenes } from '../hooks/useHue';
import { EmptyState } from '../components/EmptyState';
import { LightCard } from '../components/LightCard';
import { RoomCard } from '../components/RoomCard';
import { SceneRow } from '../components/SceneRow';
import { Skeleton } from '../components/Skeleton';

/** The dashboard from PRD §7: rooms, each with its lights. */
export function HomePage({ connected }: { connected: boolean }) {
  const rooms = useRooms(connected);
  const lights = useLights(connected);
  const scenes = useScenes(connected);

  if (rooms.isLoading || lights.isLoading) return <HomeSkeleton />;

  if (rooms.isError || lights.isError) {
    return (
      <EmptyState
        title="Nie udało się wczytać lamp"
        description="Hue Bridge nie odpowiedział. Sprawdź, czy jest w tej samej sieci."
        action={{
          label: 'Spróbuj ponownie',
          onClick: () => {
            void rooms.refetch();
            void lights.refetch();
          },
        }}
      />
    );
  }

  const allLights = lights.data ?? [];
  const ungrouped = allLights.filter((light) => light.roomId === null);
  // Scenes attached to a zone have no room to sit under, so they get their own
  // section instead of disappearing from the app entirely.
  const zoneScenes = (scenes.data ?? []).filter((scene) => scene.roomId === null);

  if (allLights.length === 0) {
    return (
      <EmptyState
        title="Brak lamp"
        description="Ten Hue Bridge nie zgłasza żadnych lamp. Dodaj je w aplikacji Philips Hue, a pojawią się tutaj."
      />
    );
  }

  return (
    <div className="space-y-6 px-4 py-4 pb-6">
      {(rooms.data ?? []).map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          lights={allLights.filter((light) => light.roomId === room.id)}
        />
      ))}

      {zoneScenes.length > 0 && (
        <section className="space-y-2">
          <h2 className="label-caps px-1">Sceny</h2>
          <SceneRow scenes={zoneScenes} />
        </section>
      )}

      {ungrouped.length > 0 && (
        <section className="space-y-2">
          <h2 className="label-caps px-1">Poza pokojami</h2>
          <div className="card-stack divide-y divide-line">
            {ungrouped.map((light) => (
              <LightCard key={light.id} light={light} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Mirrors the room-card layout so the page does not jump when data lands.
 * Exported because App.tsx shows it while the bridge connection is still coming
 * up — that is a transient state, not an error worth its own screen.
 */
export function HomeSkeleton() {
  return (
    <div className="space-y-6 px-4 py-4" aria-busy="true" aria-label="Wczytywanie lamp">
      {[0, 1, 2].map((card) => (
        <div key={card} className="card-stack">
          <div className="flex items-center gap-3 px-3.5 py-3.5">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
          <div className="divide-y divide-line border-t border-line">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-6 w-11 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
