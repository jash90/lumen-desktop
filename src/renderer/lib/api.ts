import type { SerializedAppError } from '../../shared/errors';
import type { Result } from '../../shared/ipc';

/**
 * Every IPC call comes back as a Result. Unwrapping it here means components and
 * TanStack Query see ordinary promises that reject with a message already
 * written for a human (PRD §32).
 */
export class UiError extends Error {
  readonly code: SerializedAppError['code'];

  constructor(error: SerializedAppError) {
    super(error.message);
    this.name = 'UiError';
    this.code = error.code;
  }
}

export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new UiError(result.error);
  return result.data;
}

export const messageOf = (error: unknown): string =>
  error instanceof UiError ? error.message : 'An unexpected error occurred.';

export const queryKeys = {
  lights: ['lights'] as const,
  rooms: ['rooms'] as const,
  scenes: ['scenes'] as const,
  automations: ['automations'] as const,
  connection: ['connection'] as const,
  bridges: ['bridges'] as const,
  storageHealth: ['storageHealth'] as const,
  settings: ['settings'] as const,
  shortcutConflicts: ['shortcutConflicts'] as const,
};

/** Shared by RoomCard and RoomPage, which used to carry their own copies. */
export function lightCountLabel(count: number): string {
  return count === 1 ? '1 light' : `${count} lights`;
}
