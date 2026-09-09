import { AppError } from '../../shared/errors';
import { entityStateSchema, type EntityState } from './dto';
import type { HaTransport } from './HaTransport';

/**
 * The Home Assistant REST surface the app needs: read every entity, and call a
 * service to change one.
 *
 * Live state does not come from here — that is the WebSocket's job. This is the
 * initial load and the write path.
 */

export interface ServiceTarget {
  entity_id?: string;
  area_id?: string;
}

export interface HaClient {
  /** `GET /api/` — the cheapest way to prove the URL and token are good. */
  ping(): Promise<void>;
  getStates(): Promise<EntityState[]>;
  callService(
    domain: string,
    service: string,
    target: ServiceTarget,
    data?: Record<string, unknown>,
  ): Promise<void>;
}

export function createHaClient(transport: HaTransport): HaClient {
  return {
    async ping() {
      const body = await transport.request<{ message?: string }>('/api/');
      // A reverse proxy that swallows the auth header answers 200 with someone
      // else's page; the API greeting is what proves we reached HA itself.
      if (!body?.message) {
        throw new AppError('RequestFailed', 'not a Home Assistant API endpoint');
      }
    },

    async getStates() {
      const raw = await transport.request<unknown[]>('/api/states');
      if (!Array.isArray(raw)) throw new AppError('RequestFailed', 'malformed /api/states');

      // One entity an integration reports oddly must not cost the user every
      // other light in the house, so bad rows are dropped with a warning.
      const states: EntityState[] = [];
      for (const entry of raw) {
        const parsed = entityStateSchema.safeParse(entry);
        if (parsed.success) states.push(parsed.data);
        else console.warn('[ha] skipping unparsable entity:', parsed.error.issues[0]?.message);
      }
      return states;
    },

    callService(domain, service, target, data) {
      return transport.request(`/api/services/${domain}/${service}`, {
        method: 'POST',
        body: { ...target, ...data },
      });
    },
  };
}
