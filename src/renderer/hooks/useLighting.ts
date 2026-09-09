import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type {
  Action,
  Automation,
  ConnectionStatus,
  Light,
  ResourceRef,
  RgbColor,
  Room,
  Scene,
  Settings,
} from '../../shared/models';
import { messageOf, queryKeys, unwrap } from '../lib/api';
import { useUiStore } from '../stores/uiStore';

/**
 * All server state lives here (PRD §15). Components call these hooks and never
 * touch window.lumen directly, so the IPC surface stays in one place.
 */

/** One entry per configured hub; they connect independently. */
export const useConnectionStatuses = () =>
  useQuery({
    queryKey: queryKeys.connection,
    queryFn: () => unwrap(window.lumen.getConnectionStatuses()),
  });

/**
 * True once *any* hub is up. The lists merge across hubs, so one reachable
 * bridge is enough to have something worth showing — waiting for all of them
 * would blank the screen over an unplugged hub in another room.
 */
export const useAnyConnected = (): boolean =>
  (useConnectionStatuses().data ?? []).some((status) => status.state === 'connected');

export const useHubs = () =>
  useQuery({
    queryKey: queryKeys.hubs,
    queryFn: () => unwrap(window.lumen.listHubs()),
  });

/**
 * Removing a hub must *remove* the cached resources, not merely invalidate
 * them: invalidated data stays on screen and stays clickable until the refetch
 * lands, so for a moment you can tap a light that is no longer reachable.
 */
export function useRemoveHub() {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: (id: string) => unwrap(window.lumen.removeHub(id)),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.lights });
      queryClient.removeQueries({ queryKey: queryKeys.rooms });
      queryClient.removeQueries({ queryKey: queryKeys.scenes });
      queryClient.removeQueries({ queryKey: queryKeys.automations });
      void queryClient.invalidateQueries();
    },
    onError: (error) => pushToast(messageOf(error)),
  });
}

export function useReconnectHubs() {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: () => unwrap(window.lumen.reconnectHubs()),
    onSuccess: (statuses) => queryClient.setQueryData(queryKeys.connection, statuses),
    onError: (error) => pushToast(messageOf(error)),
  });
}

export const useStorageHealth = () =>
  useQuery({
    queryKey: queryKeys.storageHealth,
    queryFn: () => unwrap(window.lumen.getStorageHealth()),
  });

export const useSettings = () =>
  useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(window.lumen.getSettings()),
  });

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => unwrap(window.lumen.setSettings(patch)),
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.settings, settings),
  });
}

export const useQuickActions = () => useSettings().data?.quickActions ?? [];
export const useShortcuts = () => useSettings().data?.shortcuts ?? [];

/** Runs an Action in the main process — the same path the tray and shortcuts use. */
export function useRunAction() {
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: (action: Action) => unwrap(window.lumen.runAction(action)),
    onError: (error) => pushToast(messageOf(error)),
  });
}

/** Accelerators the OS refused, so the settings screen can say so. */
export const useShortcutConflicts = () =>
  useQuery({
    queryKey: queryKeys.shortcutConflicts,
    queryFn: () => unwrap(window.lumen.getShortcutConflicts()),
  });

export const useFavorites = (): ResourceRef[] => useSettings().data?.favorites ?? [];

export const isFavorite = (favorites: readonly ResourceRef[], ref: ResourceRef): boolean =>
  favorites.some((favorite) => favorite.type === ref.type && favorite.id === ref.id);

/**
 * Favourites live in Settings, which is patched wholesale — so a toggle sends
 * the entire list back. Fine for one window; two racing toggles would be
 * last-write-wins.
 */
export function useToggleFavorite() {
  const favorites = useFavorites();
  const update = useUpdateSettings();

  return (ref: ResourceRef) => {
    const next = isFavorite(favorites, ref)
      ? favorites.filter((favorite) => !(favorite.type === ref.type && favorite.id === ref.id))
      : [...favorites, ref];
    update.mutate({ favorites: next });
  };
}

export function useLights(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.lights,
    queryFn: () => unwrap(window.lumen.getLights()),
    enabled,
  });
}

export function useRooms(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.rooms,
    queryFn: () => unwrap(window.lumen.getRooms()),
    enabled,
  });
}

export function useAutomations(enabled: boolean) {
  return useQuery<Automation[]>({
    queryKey: queryKeys.automations,
    queryFn: () => unwrap(window.lumen.getAutomations()),
    enabled,
  });
}

export function useSetAutomationEnabled() {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap(window.lumen.setAutomationEnabled(id, enabled)),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.automations });
      const previous = queryClient.getQueryData<Automation[]>(queryKeys.automations);
      queryClient.setQueryData<Automation[]>(queryKeys.automations, (current) =>
        current?.map((automation) => (automation.id === id ? { ...automation, enabled } : automation)),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(queryKeys.automations, context?.previous);
      pushToast(messageOf(error));
    },
    // Automations produce no event-stream traffic, so the truth has to be
    // fetched back rather than waited for.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.automations }),
  });
}

export function useScenes(enabled: boolean) {
  return useQuery<Scene[]>({
    queryKey: queryKeys.scenes,
    queryFn: () => unwrap(window.lumen.getScenes()),
    enabled,
  });
}

/**
 * Recalling a scene needs no optimistic update: the bridge reports the resulting
 * light states over the event stream, which is what the UI already listens to.
 */
export function useActivateScene() {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: (id: string) => unwrap(window.lumen.activateScene(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.scenes }),
    onError: (error) => pushToast(messageOf(error)),
  });
}

/**
 * Optimistic writes (PRD §24): the UI moves immediately, and a failed request
 * puts the old value back and explains why.
 */
function useOptimisticLight<V extends { id: string }>(
  send: (variables: V) => Promise<void>,
  patch: (light: Light, variables: V) => Light,
) {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: send,
    onMutate: async (variables: V) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.lights });
      const previous = queryClient.getQueryData<Light[]>(queryKeys.lights);
      queryClient.setQueryData<Light[]>(queryKeys.lights, (lights) =>
        lights?.map((light) => (light.id === variables.id ? patch(light, variables) : light)),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(queryKeys.lights, context?.previous);
      pushToast(messageOf(error));
    },
    // The bridge confirms the real value over the event stream, so there is no
    // refetch here — that would only fight the incoming push update.
  });
}

export const useSetLightPower = () =>
  useOptimisticLight<{ id: string; on: boolean }>(
    ({ id, on }) => unwrap(window.lumen.setLightPower(id, on)),
    (light, { on }) => ({ ...light, isOn: on }),
  );

export const useSetLightBrightness = () =>
  useOptimisticLight<{ id: string; brightness: number }>(
    ({ id, brightness }) => unwrap(window.lumen.setLightBrightness(id, brightness)),
    (light, { brightness }) => ({ ...light, brightness, isOn: brightness > 0 }),
  );

export const useSetLightTemperature = () =>
  useOptimisticLight<{ id: string; temperature: number }>(
    ({ id, temperature }) => unwrap(window.lumen.setLightTemperature(id, temperature)),
    (light, { temperature }) => ({ ...light, colorTemperature: temperature }),
  );

export const useSetLightColor = () =>
  useOptimisticLight<{ id: string; color: RgbColor }>(
    ({ id, color }) => unwrap(window.lumen.setLightColor(id, color)),
    (light, { color }) => ({ ...light, color }),
  );

function useOptimisticRoom<V extends { id: string }>(
  send: (variables: V) => Promise<void>,
  patchRoom: (room: Room, variables: V) => Room,
  patchLight: (light: Light, variables: V) => Light,
) {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: send,
    onMutate: async (variables: V) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.rooms }),
        queryClient.cancelQueries({ queryKey: queryKeys.lights }),
      ]);
      const previousRooms = queryClient.getQueryData<Room[]>(queryKeys.rooms);
      const previousLights = queryClient.getQueryData<Light[]>(queryKeys.lights);

      queryClient.setQueryData<Room[]>(queryKeys.rooms, (rooms) =>
        rooms?.map((room) => (room.id === variables.id ? patchRoom(room, variables) : room)),
      );
      // The room's lights have to move too, otherwise the cards below the room
      // header would contradict the switch the user just flipped.
      const memberIds = new Set(previousRooms?.find((r) => r.id === variables.id)?.lightIds ?? []);
      queryClient.setQueryData<Light[]>(queryKeys.lights, (lights) =>
        lights?.map((light) => (memberIds.has(light.id) ? patchLight(light, variables) : light)),
      );

      return { previousRooms, previousLights };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(queryKeys.rooms, context?.previousRooms);
      queryClient.setQueryData(queryKeys.lights, context?.previousLights);
      pushToast(messageOf(error));
    },
  });
}

export const useSetRoomPower = () =>
  useOptimisticRoom<{ id: string; on: boolean }>(
    ({ id, on }) => unwrap(window.lumen.setRoomPower(id, on)),
    (room, { on }) => ({ ...room, isOn: on }),
    (light, { on }) => ({ ...light, isOn: on }),
  );

export const useSetRoomBrightness = () =>
  useOptimisticRoom<{ id: string; brightness: number }>(
    ({ id, brightness }) => unwrap(window.lumen.setRoomBrightness(id, brightness)),
    (room, { brightness }) => ({ ...room, brightness, isOn: brightness > 0 }),
    (light, { brightness }) => ({ ...light, brightness, isOn: brightness > 0 }),
  );

/**
 * Push updates from the bridge (PRD §50). Changes made with a wall switch or the
 * Hue app land straight in the query cache — no polling, no refetch storm.
 */
export function useLightingEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const mergeById = <T extends { id: string }>(existing: T[] | undefined, incoming: T[]) => {
      if (!existing) return existing;
      const updates = new Map(incoming.map((item) => [item.id, item]));
      return existing.map((item) => updates.get(item.id) ?? item);
    };

    const unsubscribers = [
      window.lumen.onLightChanged((lights) => {
        queryClient.setQueryData<Light[]>(queryKeys.lights, (current) =>
          mergeById(current, lights),
        );
      }),
      window.lumen.onRoomChanged((rooms) => {
        queryClient.setQueryData<Room[]>(queryKeys.rooms, (current) => mergeById(current, rooms));
      }),
      window.lumen.onConnectionChanged((statuses: ConnectionStatus[]) => {
        queryClient.setQueryData(queryKeys.connection, statuses);
        // A fresh connection may have been established against a different set of
        // resources, so the lists are refetched once rather than merged.
        if (statuses.some((status) => status.state === 'connected')) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.lights });
          void queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
          void queryClient.invalidateQueries({ queryKey: queryKeys.scenes });
        }
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [queryClient]);
}
