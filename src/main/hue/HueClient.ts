import type { z } from 'zod';

import { HueError } from '../../shared/errors';
import { envelopeSchema } from './dto';
import type { HueTransport } from './HueTransport';

/**
 * The single point where the application key is attached and where an HTTP
 * status becomes a domain error (PRD §42). Nothing above this layer sees status
 * codes, and the key never leaves the main process.
 */

const API_ROOT = '/clip/v2/resource';

export interface HueClient {
  readonly transport: HueTransport;
  list<T>(resourceType: string, schema: z.ZodType<T>): Promise<T[]>;
  get<T>(resourceType: string, id: string, schema: z.ZodType<T>): Promise<T>;
  update(resourceType: string, id: string, body: unknown): Promise<void>;
}

function assertOk(status: number, body: string): void {
  if (status === 401 || status === 403) {
    throw new HueError('Unauthorized', `HTTP ${status}`);
  }
  if (status === 404) {
    throw new HueError('RequestFailed', 'resource not found');
  }
  if (status === 429) {
    throw new HueError('RequestFailed', 'bridge rate limit exceeded');
  }
  if (status < 200 || status >= 300) {
    throw new HueError('RequestFailed', `HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

function parseEnvelope(body: string): unknown[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    throw new HueError('RequestFailed', 'bridge returned malformed JSON', { cause: error });
  }

  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new HueError('RequestFailed', 'unexpected response shape');
  }

  // A v2 response can be HTTP 200 and still carry errors for individual resources.
  if (envelope.data.errors?.length) {
    throw new HueError('RequestFailed', envelope.data.errors.map((e) => e.description).join('; '));
  }

  return envelope.data.data ?? [];
}

export function createHueClient(transport: HueTransport, applicationKey: string): HueClient {
  const headers = {
    'hue-application-key': applicationKey,
    accept: 'application/json',
  };

  async function call(
    method: 'GET' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<unknown[]> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const { status, body: responseBody } = await transport.request({
      method,
      path,
      headers: payload
        ? {
            ...headers,
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(payload)),
          }
        : headers,
      body: payload,
    });

    assertOk(status, responseBody);
    return parseEnvelope(responseBody);
  }

  /**
   * Validation failures are reported per resource rather than failing the whole
   * list: one unfamiliar bulb must not blank out the entire dashboard.
   */
  function parseEach<T>(items: unknown[], schema: z.ZodType<T>, resourceType: string): T[] {
    const parsed: T[] = [];
    for (const item of items) {
      const result = schema.safeParse(item);
      if (result.success) {
        parsed.push(result.data);
      } else {
        console.warn(`[hue] skipping unparsable ${resourceType}:`, result.error.issues);
      }
    }
    return parsed;
  }

  return {
    transport,

    async list(resourceType, schema) {
      const items = await call('GET', `${API_ROOT}/${resourceType}`);
      return parseEach(items, schema, resourceType);
    },

    async get(resourceType, id, schema) {
      const items = await call('GET', `${API_ROOT}/${resourceType}/${id}`);
      const parsed = schema.safeParse(items[0]);
      if (!parsed.success) {
        throw new HueError('RequestFailed', `unexpected ${resourceType} shape`);
      }
      return parsed.data;
    },

    async update(resourceType, id, body) {
      await call('PUT', `${API_ROOT}/${resourceType}/${id}`, body);
    },
  };
}
