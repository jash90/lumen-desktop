import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { PeerCertificate } from 'node:tls';

import { HueError } from '../../shared/errors';
import { BRIDGE_ID_PATTERN, HUE_BRIDGE_ROOT_CA } from './certs';

export interface TransportResponse {
  status: number;
  body: string;
}

export interface RequestOptions {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Everything the rest of the app needs from the network. Services depend on this
 * interface, never on `node:https`, which is what lets integration tests inject a
 * fake bridge without spinning up a TLS server (PRD §34).
 */
export interface HueTransport {
  readonly ip: string;
  /** Common Name from the most recent successful handshake, i.e. the bridge id. */
  readonly peerBridgeId: string | null;
  request(options: RequestOptions): Promise<TransportResponse>;
  /** Long-lived response used for the SSE event stream; caller must consume it. */
  stream(options: RequestOptions): Promise<IncomingMessage>;
  destroy(): void;
}

const DEFAULT_TIMEOUT_MS = 8_000;

const CERT_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'HUE_CN_MISMATCH',
]);

const OFFLINE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
]);

/**
 * Turns a raw Node network failure into the domain error model. The UI must never
 * see ECONNREFUSED (PRD §32).
 */
export function mapTransportError(error: unknown): HueError {
  if (error instanceof HueError) return error;

  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);

  if (code && CERT_ERROR_CODES.has(code)) {
    return new HueError('CertificateError', message, { cause: error });
  }
  if (code && OFFLINE_ERROR_CODES.has(code)) {
    return new HueError('BridgeOffline', message, { cause: error });
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new HueError('NetworkError', message, { cause: error });
  }
  if (code === 'ABORT_ERR' || (error as Error)?.name === 'AbortError') {
    return new HueError('BridgeOffline', 'request aborted', { cause: error });
  }
  return new HueError('NetworkError', message, { cause: error });
}

/**
 * TLS against a Hue Bridge, done properly (PRD §63.2).
 *
 * The bridge presents a certificate issued by Signify's `root-bridge` CA whose
 * Common Name is the bridge id and which carries no subjectAltName. So we:
 *   1. trust *only* the bundled Hue root CA — not the OS store, and we never set
 *      `rejectUnauthorized: false` anywhere in this app;
 *   2. replace the hostname check (which compares against the IP and would always
 *      fail) with an explicit Common Name check against the expected bridge id.
 *
 * Before pairing the bridge id is not yet known, so `expectedBridgeId` may be null:
 * the chain is still fully verified — proving we are talking to a genuine Hue
 * Bridge — and the CN is captured in `peerBridgeId` so the pairing service can
 * confirm it matches the id the bridge reports about itself.
 */
export function createHueTransport(ip: string, expectedBridgeId: string | null): HueTransport {
  let peerBridgeId: string | null = null;

  const checkServerIdentity = (_host: string, cert: PeerCertificate): Error | undefined => {
    // @types/node models CN as string | string[]; a bridge only ever sends one.
    const rawCn = cert.subject?.CN;
    const cn = (Array.isArray(rawCn) ? rawCn[0] : rawCn)?.toLowerCase();
    if (!cn || !BRIDGE_ID_PATTERN.test(cn)) {
      return Object.assign(
        new Error(`certificate CN "${String(rawCn)}" is not a Hue bridge id`),
        { code: 'HUE_CN_MISMATCH' },
      );
    }
    if (expectedBridgeId && cn !== expectedBridgeId.toLowerCase()) {
      return Object.assign(
        new Error(`bridge id mismatch: expected ${expectedBridgeId}, got ${cn}`),
        { code: 'HUE_CN_MISMATCH' },
      );
    }
    peerBridgeId = cn;
    return undefined;
  };

  const agentOptions: https.AgentOptions = {
    ca: HUE_BRIDGE_ROOT_CA,
    rejectUnauthorized: true,
    checkServerIdentity,
    keepAlive: true,
  };

  // The bridge is modest embedded hardware; a handful of sockets is plenty.
  const agent = new https.Agent({ ...agentOptions, maxSockets: 4 });
  // The event stream holds its socket open forever, so it gets its own pool —
  // otherwise it would permanently occupy one of the request slots.
  const streamAgent = new https.Agent({ ...agentOptions, maxSockets: 1 });

  const send = (
    options: RequestOptions,
    useStreamAgent: boolean,
  ): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
      const request = https.request(
        {
          host: ip,
          port: 443,
          method: options.method,
          path: options.path,
          agent: useStreamAgent ? streamAgent : agent,
          headers: options.headers,
          signal: options.signal,
        },
        resolve,
      );

      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (timeoutMs > 0) {
        request.setTimeout(timeoutMs, () => {
          request.destroy(
            Object.assign(new Error(`request to ${ip} timed out`), { code: 'ETIMEDOUT' }),
          );
        });
      }

      request.on('error', (error) => reject(mapTransportError(error)));
      if (options.body) request.write(options.body);
      request.end();
    });

  return {
    ip,
    get peerBridgeId() {
      return peerBridgeId;
    },

    async request(options) {
      const response = await send(options, false);
      return new Promise<TransportResponse>((resolve, reject) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        response.on('error', (error) => reject(mapTransportError(error)));
      });
    },

    async stream(options) {
      // No timeout: an idle event stream is normal, the bridge only speaks when
      // something changes.
      return send({ ...options, timeoutMs: 0 }, true);
    },

    destroy() {
      agent.destroy();
      streamAgent.destroy();
    },
  };
}
