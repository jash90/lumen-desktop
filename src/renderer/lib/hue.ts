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
  scenes: ['scenes'] as const,
  connection: ['connection'] as const,
  storageHealth: ['storageHealth'] as const,
  settings: ['settings'] as const,
};

/**
 * Polish plural for "lampa": 1 takes the singular, 2–4 (but not 12–14) take the
 * "few" form, everything else the genitive plural. Lived in RoomCard before,
 * while RoomPage carried its own version that got "2 lampy" wrong.
 */
export function lightCountLabel(count: number): string {
  if (count === 1) return '1 lampa';
  const lastTwo = count % 100;
  const last = count % 10;
  const few = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return `${count} ${few ? 'lampy' : 'lamp'}`;
}
