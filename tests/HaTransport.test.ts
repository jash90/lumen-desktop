import { describe, expect, it } from 'vitest';

import { mapHaError, normaliseBaseUrl, socketUrlFor } from '../src/main/homeassistant/HaTransport';

describe('normaliseBaseUrl', () => {
  it('drops a trailing slash, which would otherwise double up in every path', () => {
    expect(normaliseBaseUrl('http://homeassistant.local:8123/')).toBe(
      'http://homeassistant.local:8123',
    );
    expect(normaliseBaseUrl('  http://ha.local:8123//  ')).toBe('http://ha.local:8123');
  });

  it('rejects what is not an http(s) URL rather than failing later at fetch', () => {
    expect(() => normaliseBaseUrl('homeassistant.local')).toThrowError(/not a valid URL/);
    expect(() => normaliseBaseUrl('ftp://ha.local')).toThrowError(/unsupported protocol/);
  });
});

describe('socketUrlFor', () => {
  it('follows the scheme of the instance it belongs to', () => {
    expect(socketUrlFor('http://ha.local:8123')).toBe('ws://ha.local:8123/api/websocket');
    expect(socketUrlFor('https://ha.example.com')).toBe('wss://ha.example.com/api/websocket');
  });
});

describe('mapHaError', () => {
  /**
   * undici's own message is always "fetch failed"; the code that says what
   * actually happened is on `cause`, and the UI must never see either (PRD §32).
   */
  const withCause = (code: string): unknown =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('boom'), { code }),
    });

  it('reads a refused connection as an unreachable hub', () => {
    expect(mapHaError(withCause('ECONNREFUSED')).code).toBe('BridgeOffline');
  });

  it('separates a name that will not resolve from a hub that is down', () => {
    expect(mapHaError(withCause('ENOTFOUND')).code).toBe('NetworkError');
  });

  it('names a certificate problem as one, so the message can be acted on', () => {
    expect(mapHaError(withCause('ERR_TLS_CERT_ALTNAME_INVALID')).code).toBe('CertificateError');
  });

  it('treats a timeout as the hub being unreachable', () => {
    const error = new Error('timed out');
    error.name = 'AbortError';
    expect(mapHaError(error).code).toBe('BridgeOffline');
  });

  it('never leaks the technical detail into what the user is shown', () => {
    expect(mapHaError(withCause('ECONNREFUSED')).userMessage).not.toContain('ECONNREFUSED');
  });
});
