import { AppError } from '../../shared/errors';
import {
  areaSchema,
  deviceSchema,
  entityRegistryEntrySchema,
  socketMessageSchema,
  stateChangedEventSchema,
  type Area,
  type EntityState,
} from './dto';
import type { HaTransport } from './HaTransport';

/**
 * The Home Assistant push channel — the counterpart of the Hue event stream.
 *
 * Deliberately has no retry of its own: reconnecting is ProviderConnection's
 * decision, and a socket that reconnected itself would race the backoff and
 * produce two live connections to the same hub.
 *
 * The registries come over this socket rather than REST because Home Assistant
 * exposes them nowhere else — and they are what turns a flat list of entities
 * into rooms.
 */

const CONNECT_TIMEOUT_MS = 10_000;

export interface AreaRegistry {
  areas: Area[];
  /** entity_id -> area_id, already resolved through the device it belongs to. */
  areaByEntity: Map<string, string>;
}

export interface HaSocket {
  registry(): Promise<AreaRegistry>;
  /** Starts delivering `state_changed`. Call once the initial load is done. */
  subscribe(): Promise<void>;
  close(): void;
}

export interface HaSocketOptions {
  transport: HaTransport;
  onStateChanged(entityId: string, state: EntityState | null): void;
  /** Called once when the socket drops on its own — never from close(). */
  onClosed(error?: Error): void;
}

export async function openHaSocket(options: HaSocketOptions): Promise<HaSocket> {
  const { transport, onStateChanged, onClosed } = options;

  const socket = new WebSocket(transport.socketUrl);
  let nextId = 1;
  let closedReported = false;

  /** Resolvers for command ids still waiting on a `result` message. */
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  const reportClosed = (error?: Error): void => {
    if (closedReported) return;
    closedReported = true;
    for (const waiter of pending.values()) {
      waiter.reject(error ?? new AppError('BridgeOffline', 'socket closed'));
    }
    pending.clear();
    onClosed(error);
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new AppError('BridgeOffline', 'timed out waiting for the Home Assistant socket'));
    }, CONNECT_TIMEOUT_MS);

    const settleError = (error: AppError): void => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    };

    socket.addEventListener('message', (event) => {
      const parsed = socketMessageSchema.safeParse(
        JSON.parse(typeof event.data === 'string' ? event.data : ''),
      );
      if (!parsed.success) return;
      const message = parsed.data;

      switch (message.type) {
        case 'auth_required':
          socket.send(JSON.stringify({ type: 'auth', access_token: transport.token }));
          return;

        case 'auth_ok':
          clearTimeout(timer);
          resolve();
          return;

        case 'auth_invalid':
          // A rejected token never fixes itself, so this must not look like a
          // network blip the connection layer would retry forever.
          settleError(new AppError('Unauthorized', message.message ?? 'token rejected'));
          return;

        case 'result': {
          const waiter = message.id === undefined ? undefined : pending.get(message.id);
          if (!waiter || message.id === undefined) return;
          pending.delete(message.id);
          if (message.success) waiter.resolve(message.result);
          else waiter.reject(new AppError('RequestFailed', message.message ?? 'command failed'));
          return;
        }

        case 'event': {
          const event_ = stateChangedEventSchema.safeParse(message.event);
          if (event_.success) {
            onStateChanged(event_.data.data.entity_id, event_.data.data.new_state);
          }
          return;
        }
      }
    });

    socket.addEventListener('error', () => {
      // The browser-shaped API gives no detail here; the close event follows.
      settleError(new AppError('BridgeOffline', 'could not reach the Home Assistant socket'));
    });

    socket.addEventListener('close', () => {
      clearTimeout(timer);
      reject(new AppError('BridgeOffline', 'the Home Assistant socket closed'));
      reportClosed();
    });
  });

  const send = <T>(payload: Record<string, unknown>): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify({ ...payload, id }));
    });
  };

  return {
    async registry() {
      const [rawAreas, rawDevices, rawEntities] = await Promise.all([
        send<unknown[]>({ type: 'config/area_registry/list' }),
        send<unknown[]>({ type: 'config/device_registry/list' }),
        send<unknown[]>({ type: 'config/entity_registry/list' }),
      ]);

      const areas = rawAreas.flatMap((entry) => {
        const parsed = areaSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      });

      const areaByDevice = new Map<string, string>();
      for (const entry of rawDevices) {
        const parsed = deviceSchema.safeParse(entry);
        if (parsed.success && parsed.data.area_id) {
          areaByDevice.set(parsed.data.id, parsed.data.area_id);
        }
      }

      const areaByEntity = new Map<string, string>();
      for (const entry of rawEntities) {
        const parsed = entityRegistryEntrySchema.safeParse(entry);
        if (!parsed.success) continue;
        // An entity moved out of its device's area by hand carries its own
        // area_id, and that wins over the device's.
        const areaId =
          parsed.data.area_id ??
          (parsed.data.device_id ? areaByDevice.get(parsed.data.device_id) : undefined);
        if (areaId) areaByEntity.set(parsed.data.entity_id, areaId);
      }

      return { areas, areaByEntity };
    },

    async subscribe() {
      await send({ type: 'subscribe_events', event_type: 'state_changed' });
    },

    close() {
      // Deliberately no reportClosed(): the caller asked for this and already
      // knows. Firing onClosed here would have it treat its own teardown as a
      // dropped connection. The Hue stream has always behaved this way; this
      // is the contract now written down in ProviderHooks.
      closedReported = true;
      socket.close();
    },
  };
}
