import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ConnectionStatus, Light, RgbColor, Room, Settings } from '../../shared/models';
import { messageOf, queryKeys, unwrap } from '../lib/hue';
import { useUiStore } from '../stores/uiStore';

/**
 * All server state lives here (PRD §15). Components call these hooks and never
 * touch window.hue directly, so the IPC surface stays in one place.
 */

export const useConnectionStatus = () =>
  useQuery({
    queryKey: queryKeys.connection,
    queryFn: () => unwrap(window.hue.getConnectionStatus()),
  });

export const useStorageHealth = () =>
  useQuery({
    queryKey: queryKeys.storageHealth,
    queryFn: () => unwrap(window.hue.getStorageHealth()),
  });

export const useSettings = () =>
  useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(window.hue.getSettings()),
  });

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => unwrap(window.hue.setSettings(patch)),
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.settings, settings),
  });
}

export function useLights(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.lights,
    queryFn: () => unwrap(window.hue.getLights()),
    enabled,
  });
}

export function useRooms(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.rooms,
    queryFn: () => unwrap(window.hue.getRooms()),
    enabled,
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
    ({ id, on }) => unwrap(window.hue.setLightPower(id, on)),
    (light, { on }) => ({ ...light, isOn: on }),
  );

export const useSetLightBrightness = () =>
  useOptimisticLight<{ id: string; brightness: number }>(
    ({ id, brightness }) => unwrap(window.hue.setLightBrightness(id, brightness)),
    (light, { brightness }) => ({ ...light, brightness, isOn: brightness > 0 }),
  );

export const useSetLightTemperature = () =>
  useOptimisticLight<{ id: string; temperature: number }>(
    ({ id, temperature }) => unwrap(window.hue.setLightTemperature(id, temperature)),
    (light, { temperature }) => ({ ...light, colorTemperature: temperature }),
  );

export const useSetLightColor = () =>
  useOptimisticLight<{ id: string; color: RgbColor }>(
    ({ id, color }) => unwrap(window.hue.setLightColor(id, color)),
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
    ({ id, on }) => unwrap(window.hue.setRoomPower(id, on)),
    (room, { on }) => ({ ...room, isOn: on }),
    (light, { on }) => ({ ...light, isOn: on }),
  );

export const useSetRoomBrightness = () =>
  useOptimisticRoom<{ id: string; brightness: number }>(
    ({ id, brightness }) => unwrap(window.hue.setRoomBrightness(id, brightness)),
    (room, { brightness }) => ({ ...room, brightness, isOn: brightness > 0 }),
    (light, { brightness }) => ({ ...light, brightness, isOn: brightness > 0 }),
  );

/**
 * Push updates from the bridge (PRD §50). Changes made with a wall switch or the
 * Hue app land straight in the query cache — no polling, no refetch storm.
 */
export function useHueEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const mergeById = <T extends { id: string }>(existing: T[] | undefined, incoming: T[]) => {
      if (!existing) return existing;
      const updates = new Map(incoming.map((item) => [item.id, item]));
      return existing.map((item) => updates.get(item.id) ?? item);
    };

    const unsubscribers = [
      window.hue.onLightChanged((lights) => {
        queryClient.setQueryData<Light[]>(queryKeys.lights, (current) =>
          mergeById(current, lights),
        );
      }),
      window.hue.onRoomChanged((rooms) => {
        queryClient.setQueryData<Room[]>(queryKeys.rooms, (current) => mergeById(current, rooms));
      }),
      window.hue.onConnectionChanged((status: ConnectionStatus) => {
        queryClient.setQueryData(queryKeys.connection, status);
        // A fresh connection may have been established against a different set of
        // resources, so the lists are refetched once rather than merged.
        if (status.state === 'connected') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.lights });
          void queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
        }
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [queryClient]);
}
