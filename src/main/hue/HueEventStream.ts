import type { IncomingMessage } from 'node:http';

import { mapTransportError, type HueTransport } from './HueTransport';
import type { UnknownResource } from './HueApi';

/**
 * Server-sent events from the bridge (PRD §23, §50).
 *
 * Replaces polling entirely: changes made with a wall switch, the Hue app or a
 * voice assistant arrive here. The stream deliberately does not retry — the
 * ConnectionManager owns the single retry policy for the whole connection, so
 * this just reports that it closed.
 */

export interface EventStreamHandle {
  stop(): void;
}

export interface EventStreamOptions {
  transport: HueTransport;
  applicationKey: string;
  onUpdates(updates: UnknownResource[]): void;
  /** Called once when the stream ends for any reason, including stop(). */
  onClosed(error?: Error): void;
}

interface EventContainer {
  type?: string;
  data?: UnknownResource[];
}

/**
 * Minimal SSE reader. The bridge only ever sends `id:` and `data:` lines and one
 * JSON array per event, so a full SSE client would be dead weight here.
 */
export function parseSseChunk(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;

  for (;;) {
    const boundary = rest.indexOf('\n\n');
    if (boundary === -1) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);

    const payload = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');

    if (payload) events.push(payload);
  }

  return { events, rest };
}

export async function startEventStream(
  options: EventStreamOptions,
): Promise<EventStreamHandle> {
  const controller = new AbortController();
  let closed = false;

  const close = (error?: Error) => {
    if (closed) return;
    closed = true;
    options.onClosed(error);
  };

  let response: IncomingMessage;
  try {
    response = await options.transport.stream({
      method: 'GET',
      path: '/eventstream/clip/v2',
      headers: {
        'hue-application-key': options.applicationKey,
        accept: 'text/event-stream',
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw mapTransportError(error);
  }

  if (response.statusCode !== 200) {
    response.destroy();
    throw mapTransportError(
      Object.assign(new Error(`event stream returned HTTP ${response.statusCode}`), {
        code: response.statusCode === 401 || response.statusCode === 403 ? 'HUE_UNAUTHORIZED' : undefined,
      }),
    );
  }

  let buffer = '';
  response.setEncoding('utf8');

  response.on('data', (chunk: string) => {
    buffer += chunk;
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;

    for (const raw of events) {
      let containers: EventContainer[];
      try {
        containers = JSON.parse(raw) as EventContainer[];
      } catch {
        // A truncated or unexpected frame must not kill a healthy stream.
        console.warn('[hue] ignoring malformed event frame');
        continue;
      }
      const updates = containers
        .filter((container) => container.type === 'update')
        .flatMap((container) => container.data ?? []);
      if (updates.length > 0) options.onUpdates(updates);
    }
  });

  response.on('error', (error) => close(mapTransportError(error)));
  response.on('end', () => close());
  response.on('close', () => close());

  return {
    stop() {
      closed = true;
      controller.abort();
      response.destroy();
    },
  };
}
