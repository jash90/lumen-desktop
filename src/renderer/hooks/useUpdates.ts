import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { UpdateStatus } from '../../shared/ipc';
import { messageOf, queryKeys, unwrap } from '../lib/api';
import { useUiStore } from '../stores/uiStore';

/**
 * Update state lives in the main process, which also drives it from the tray,
 * so the renderer mirrors it through the push channel rather than owning it.
 */

export const useAppVersion = () =>
  useQuery({
    queryKey: queryKeys.version,
    queryFn: () => unwrap(window.lumen.getVersion()),
    staleTime: Infinity,
  });

export function useUpdateStatus() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      window.lumen.onUpdateStatus((status) =>
        queryClient.setQueryData<UpdateStatus>(queryKeys.updateStatus, status),
      ),
    [queryClient],
  );

  return useQuery({
    queryKey: queryKeys.updateStatus,
    queryFn: () => unwrap(window.lumen.getUpdateStatus()),
  });
}

export function useCheckForUpdates() {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: () => unwrap(window.lumen.checkForUpdates()),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.updateStatus, status),
    onError: (error) => pushToast(messageOf(error)),
  });
}

export function useInstallUpdate() {
  const pushToast = useUiStore((state) => state.pushToast);

  return useMutation({
    mutationFn: () => unwrap(window.lumen.installUpdate()),
    onError: (error) => pushToast(messageOf(error)),
  });
}
