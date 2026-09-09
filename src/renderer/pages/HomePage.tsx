import type { Room } from '../../shared/models';
import {
  useFavorites,
  useLights,
  useRooms,
  useScenes,
  useSetRoomPower,
} from '../hooks/useLighting';
import { lightCountLabel } from '../lib/api';
import { useUiStore } from '../stores/uiStore';
import { EmptyState } from '../components/EmptyState';
import { FavoriteButton } from '../components/FavoriteButton';
import { QuickActions } from '../components/QuickActions';
import { PowerSwitch } from '../components/PowerSwitch';
import { LightCard } from '../components/LightCard';
import { RoomCard } from '../components/RoomCard';
import { SceneRow } from '../components/SceneRow';
import { Skeleton } from '../components/Skeleton';

/** The dashboard from PRD §7: rooms, each with its lights. */
export function HomePage({ connected }: { connected: boolean }) {
  const rooms = useRooms(connected);
  const lights = useLights(connected);
  const scenes = useScenes(connected);
  const favorites = useFavorites();

  if (rooms.isLoading || lights.isLoading) return <HomeSkeleton />;

  if (rooms.isError || lights.isError) {
    return (
      <EmptyState
        title="Could not load the lights"
        description="The Hue Bridge did not respond. Check that it is on the same network."
        action={{
          label: 'Try again',
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

  // Resolved against what the bridge currently reports rather than by pruning
  // the stored list: a bridge that is briefly offline is not a deleted light.
  const favoriteLights = favorites
    .filter((favorite) => favorite.type === 'light')
    .map((favorite) => allLights.find((light) => light.id === favorite.id))
    .filter((light): light is NonNullable<typeof light> => light !== undefined);
  const favoriteRooms = favorites
    .filter((favorite) => favorite.type === 'room')
    .map((favorite) => (rooms.data ?? []).find((room) => room.id === favorite.id))
    .filter((room): room is NonNullable<typeof room> => room !== undefined);
  const favoriteScenes = favorites
    .filter((favorite) => favorite.type === 'scene')
    .map((favorite) => (scenes.data ?? []).find((scene) => scene.id === favorite.id))
    .filter((scene): scene is NonNullable<typeof scene> => scene !== undefined);
  const hasFavorites =
    favoriteLights.length + favoriteRooms.length + favoriteScenes.length > 0;

  if (allLights.length === 0) {
    return (
      <EmptyState
        title="No lights"
        description="This Hue Bridge reports no lights. Add them in the Philips Hue app and they will show up here."
      />
    );
  }

  return (
    <div className="space-y-6 px-4 py-4 pb-6">
      <QuickActions />

      {hasFavorites && (
        <section className="space-y-2">
          <h2 className="label-caps px-1">Favorites</h2>
          {favoriteScenes.length > 0 && <SceneRow scenes={favoriteScenes} />}
          {(favoriteRooms.length > 0 || favoriteLights.length > 0) && (
            <div className="card-stack divide-y divide-line">
              {favoriteRooms.map((room) => (
                <FavoriteRoomRow key={room.id} room={room} />
              ))}
              {favoriteLights.map((light) => (
                <LightCard key={light.id} light={light} />
              ))}
            </div>
          )}
        </section>
      )}

      {(rooms.data ?? []).map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          lights={allLights.filter((light) => light.roomId === room.id)}
        />
      ))}

      {zoneScenes.length > 0 && (
        <section className="space-y-2">
          <h2 className="label-caps px-1">Scenes</h2>
          <SceneRow scenes={zoneScenes} />
        </section>
      )}

      {ungrouped.length > 0 && (
        <section className="space-y-2">
          <h2 className="label-caps px-1">Outside rooms</h2>
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
 * A pinned room as a single row — the full RoomCard would repeat the whole room
 * further down the page.
 */
function FavoriteRoomRow({ room }: { room: Room }) {
  const setPower = useSetRoomPower();
  const navigate = useUiStore((state) => state.navigate);

  return (
    <div className="group/row flex items-center gap-2 px-3.5 py-3">
      <button
        type="button"
        onClick={() => navigate({ name: 'room', id: room.id })}
        className="min-w-0 flex-1 rounded-row text-left focus-visible:focus-ring"
      >
        <span className="block truncate text-sm font-medium">{room.name}</span>
        <span className="text-xs text-ink-muted">
          {lightCountLabel(room.lightIds.length)} · room
        </span>
      </button>
      <FavoriteButton target={{ type: 'room', id: room.id }} label={`room ${room.name}`} />
      <PowerSwitch
        checked={room.isOn}
        label={`Toggle room ${room.name}`}
        onCheckedChange={(on) => setPower.mutate({ id: room.id, on })}
      />
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
    <div className="space-y-6 px-4 py-4" aria-busy="true" aria-label="Loading lights">
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
