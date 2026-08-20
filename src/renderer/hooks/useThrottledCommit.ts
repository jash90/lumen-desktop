import { useCallback, useEffect, useRef } from 'react';

/**
 * Rate-limits slider traffic to the bridge (PRD §46).
 *
 * Dragging a slider fires dozens of events per second; the bridge tolerates
 * roughly ten writes per second for a light and only one for a room. This lets
 * the UI update on every frame while the network sees a trailing-edge sample —
 * and `flush` sends the exact final value the moment the user lets go, so the
 * light never settles on a stale intermediate level.
 */
export function useThrottledCommit<T>(commit: (value: T) => void, intervalMs: number) {
  const lastSentAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clear, []);

  const send = useCallback((value: T) => {
    lastSentAt.current = Date.now();
    pending.current = null;
    commitRef.current(value);
  }, []);

  const throttled = useCallback(
    (value: T) => {
      const elapsed = Date.now() - lastSentAt.current;
      if (elapsed >= intervalMs) {
        clear();
        send(value);
        return;
      }
      pending.current = value;
      if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null;
          if (pending.current !== null) send(pending.current);
        }, intervalMs - elapsed);
      }
    },
    [intervalMs, send],
  );

  const flush = useCallback(
    (value: T) => {
      clear();
      send(value);
    },
    [send],
  );

  return { throttled, flush };
}

/** Per-light writes; the bridge accepts about ten a second. */
export const LIGHT_THROTTLE_MS = 120;
/** grouped_light is limited to roughly one write a second. */
export const ROOM_THROTTLE_MS = 1_000;
