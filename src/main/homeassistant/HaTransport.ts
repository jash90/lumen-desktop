import { AppError } from '../../shared/errors';

/**
 * HTTP to a Home Assistant instance, with a bearer token.
 *
 * Ordinary TLS verification, unlike the Hue transport: a Home Assistant install
 * either serves plain HTTP on the LAN or presents a certificate from a real CA.
 * There is deliberately no `rejectUnauthorized: false` here — a self-signed
 * certificate is a configuration the user has to fix on their side, not
 * something this app quietly accepts on their behalf.
 *
 * `fetch` and `WebSocket` are Node globals in the Electron main process
 * (Electron 43 runs Node 24), so this needs no dependency of its own.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export interface HaTransport {
  readonly baseUrl: string;
  /** WebSocket URL for the same instance — the ws(s) sibling of baseUrl. */
  readonly socketUrl: string;
  readonly token: string;
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
}

/** Trailing slashes would double up when joined with a path. */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError('RequestFailed', `not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('RequestFailed', `unsupported protocol: ${url.protocol}`);
  }
  return trimmed;
}

export function socketUrlFor(baseUrl: string): string {
  const url = new URL(`${baseUrl}/api/websocket`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** The renderer must never see a raw fetch failure (PRD §32). */
export function mapHaError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === 'AbortError') {
    return new AppError('BridgeOffline', 'request timed out', { cause: error });
  }

  // undici reports the useful part on `cause`; the outer message is always the
  // same unhelpful "fetch failed".
  const cause = (error as { cause?: NodeJS.ErrnoException }).cause;
  const code = cause?.code;

  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new AppError('BridgeOffline', cause?.message ?? message, { cause: error });
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new AppError('NetworkError', cause?.message ?? message, { cause: error });
  }
  if (code?.startsWith('ERR_TLS') || code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return new AppError('CertificateError', cause?.message ?? message, { cause: error });
  }
  return new AppError('NetworkError', message, { cause: error });
}

function assertOk(status: number, path: string): void {
  if (status >= 200 && status < 300) return;
  // 401 is a revoked or mistyped token; retrying it forever would be pointless,
  // and the connection layer stops on this code specifically.
  if (status === 401 || status === 403) {
    throw new AppError('Unauthorized', `${status} for ${path}`);
  }
  if (status === 404) throw new AppError('RequestFailed', `not found: ${path}`);
  throw new AppError('RequestFailed', `HTTP ${status} for ${path}`);
}

export function createHaTransport(rawBaseUrl: string, token: string): HaTransport {
  const baseUrl = normaliseBaseUrl(rawBaseUrl);

  return {
    baseUrl,
    socketUrl: socketUrlFor(baseUrl),
    token,

    async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
      const body = init?.body === undefined ? undefined : JSON.stringify(init.body);

      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method: init?.method ?? 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        throw mapHaError(error);
      }

      assertOk(response.status, path);

      const text = await response.text();
      if (text.length === 0) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw new AppError('RequestFailed', `malformed response for ${path}`, { cause: error });
      }
    },
  };
}
