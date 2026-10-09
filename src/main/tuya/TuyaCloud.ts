import crypto from 'node:crypto';

import { AppError } from '../../shared/errors';
import type { TuyaRegion } from '../../shared/ipc';

/**
 * Reads device names and local keys from the Tuya Cloud, once, at setup.
 *
 * The local key never leaves a device over the LAN — it is issued at pairing
 * and lives only in the firmware and in Tuya's cloud — so the cloud is the one
 * place to get it. This replaces the `tinytuya wizard` step: the same project
 * credentials, the same API, without Python.
 *
 * Nothing here is used after setup. Control stays local, and the Access Secret
 * is neither stored nor sent anywhere but Tuya.
 */

/** The OpenAPI host per data center. A project lives in exactly one. */
export const TUYA_HOSTS: Record<TuyaRegion, string> = {
  eu: 'openapi.tuyaeu.com',
  'eu-west': 'openapi-weaz.tuyaeu.com',
  us: 'openapi.tuyaus.com',
  'us-east': 'openapi-ueaz.tuyaus.com',
  cn: 'openapi.tuyacn.com',
  in: 'openapi.tuyain.com',
  sg: 'openapi-sg.iotbing.com',
};

export interface TuyaCloudCredentials {
  region: TuyaRegion;
  accessId: string;
  accessSecret: string;
}

export interface CloudDevice {
  deviceId: string;
  name: string;
  localKey: string;
  /** Tuya's product category, e.g. "dj" for a light; empty when not given. */
  category: string;
  productName: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const EMPTY_BODY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

/**
 * Tuya's request signature (the "new" algorithm, current since 2021):
 *
 *   HMAC-SHA256(secret, accessId + [token] + t + METHOD\nsha256(body)\n\npath?query)
 *
 * upper-cased hex. Query keys have to be in alphabetical order, unencoded.
 */
export function signRequest(input: {
  accessId: string;
  accessSecret: string;
  token?: string;
  t: string;
  method: 'GET';
  pathWithQuery: string;
}): string {
  const stringToSign = [input.method, EMPTY_BODY_SHA256, '', input.pathWithQuery].join('\n');
  return crypto
    .createHmac('sha256', input.accessSecret)
    .update(input.accessId + (input.token ?? '') + input.t + stringToSign)
    .digest('hex')
    .toUpperCase();
}

const withQuery = (path: string, query: Record<string, string>): string => {
  const keys = Object.keys(query).sort();
  return keys.length === 0 ? path : `${path}?${keys.map((key) => `${key}=${query[key]}`).join('&')}`;
};

interface Envelope {
  success?: boolean;
  code?: number;
  msg?: string;
  result?: unknown;
}

const MAX_PAGES = 20;

export async function fetchCloudDevices(
  credentials: TuyaCloudCredentials,
  fetchImpl: Fetch,
  now: () => number = Date.now,
): Promise<CloudDevice[]> {
  const host = TUYA_HOSTS[credentials.region];
  const accessId = credentials.accessId.trim();
  const accessSecret = credentials.accessSecret.trim();

  const get = async (pathWithQuery: string, token?: string): Promise<Envelope> => {
    const t = String(now());
    const headers: Record<string, string> = {
      client_id: accessId,
      t,
      sign_method: 'HMAC-SHA256',
      sign: signRequest({ accessId, accessSecret, token, t, method: 'GET', pathWithQuery }),
      ...(token ? { access_token: token } : {}),
    };
    let response;
    try {
      response = await fetchImpl(`https://${host}${pathWithQuery}`, { method: 'GET', headers });
    } catch (error) {
      throw new AppError('NetworkError', `Tuya Cloud unreachable: ${String(error)}`, {
        cause: error,
      });
    }
    if (!response.ok) throw new AppError('RequestFailed', `Tuya Cloud answered ${response.status}`);
    return (await response.json()) as Envelope;
  };

  const token = await get('/v1.0/token?grant_type=1');
  const accessToken = (token.result as { access_token?: unknown } | undefined)?.access_token;
  if (!token.success || typeof accessToken !== 'string') {
    // A wrong ID, a wrong secret and the wrong data center all end here.
    throw new AppError('CloudUnauthorized', `token: ${token.code} ${token.msg}`);
  }

  const devices: CloudDevice[] = [];
  const query: Record<string, string> = { size: '50' };
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listed = await get(
      withQuery('/v1.0/iot-01/associated-users/devices', query),
      accessToken,
    );
    if (!listed.success) {
      throw new AppError('CloudPermission', `devices: ${listed.code} ${listed.msg}`);
    }
    const result = (listed.result ?? {}) as {
      devices?: unknown[];
      has_more?: unknown;
      last_row_key?: unknown;
    };
    for (const raw of result.devices ?? []) {
      const entry = raw as Record<string, unknown>;
      if (typeof entry.id !== 'string' || typeof entry.local_key !== 'string') continue;
      devices.push({
        deviceId: entry.id,
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.id,
        localKey: entry.local_key,
        category: typeof entry.category === 'string' ? entry.category : '',
        productName: typeof entry.product_name === 'string' ? entry.product_name : '',
      });
    }
    if (result.has_more !== true || typeof result.last_row_key !== 'string') break;
    query.last_row_key = result.last_row_key;
  }

  return devices;
}

/**
 * Tuya categories that are lights: bulbs, strips, ceiling and string lights,
 * and the rest of the "lighting" family. Used only to pre-select rows — the
 * device itself is still asked what it is before anything is stored.
 */
const LIGHT_CATEGORIES = new Set(['dj', 'dd', 'xdd', 'fwd', 'dc', 'tgq', 'tyndj', 'gyd', 'fsd']);

export const isLightCategory = (category: string): boolean => LIGHT_CATEGORIES.has(category);
