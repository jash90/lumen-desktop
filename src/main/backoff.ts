/** Reconnect delays from PRD §25, capped at the last step. */
export const BACKOFF_STEPS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[index] ?? BACKOFF_STEPS_MS[BACKOFF_STEPS_MS.length - 1]!;
}
