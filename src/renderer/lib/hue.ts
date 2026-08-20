import type { SerializedHueError } from '../../shared/errors';
import type { Result } from '../../shared/ipc';

/**
 * Every IPC call comes back as a Result. Unwrapping it here means components and
 * TanStack Query see ordinary promises that reject with a message already
 * written for a human (PRD §32).
 */
export class HueUiError extends Error {
  readonly code: SerializedHueError['code'];

  constructor(error: SerializedHueError) {
    super(error.message);
    this.name = 'HueUiError';
    this.code = error.code;
  }
}

export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new HueUiError(result.error);
  return result.data;
}

export const messageOf = (error: unknown): string =>
  error instanceof HueUiError ? error.message : 'Wystąpił nieoczekiwany błąd.';

export const queryKeys = {
  lights: ['lights'] as const,
  rooms: ['rooms'] as const,
  connection: ['connection'] as const,
  storageHealth: ['storageHealth'] as const,
  settings: ['settings'] as const,
};
