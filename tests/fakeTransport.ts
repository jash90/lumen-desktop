import type { IncomingMessage } from 'node:http';

import type { HueTransport, RequestOptions, TransportResponse } from '../src/main/hue/HueTransport';

/**
 * Stands in for a real bridge in integration tests (PRD §34).
 *
 * Injecting at the transport seam means the tests exercise the client, mapper and
 * domain service for real, without needing a TLS server or certificates.
 */
export interface FakeTransport extends HueTransport {
  readonly calls: RequestOptions[];
}

type Responder = (options: RequestOptions) => TransportResponse | Promise<TransportResponse>;

export function createFakeTransport(responder: Responder): FakeTransport {
  const calls: RequestOptions[] = [];

  return {
    ip: '192.0.2.10',
    peerBridgeId: 'aabbccddeeff0011',
    calls,
    async request(options) {
      calls.push(options);
      return responder(options);
    },
    async stream() {
      throw new Error('stream() not used in these tests');
      // eslint-disable-next-line no-unreachable
      return undefined as unknown as IncomingMessage;
    },
    destroy() {
      /* nothing to release */
    },
  };
}

export const jsonResponse = (data: unknown, status = 200): TransportResponse => ({
  status,
  body: JSON.stringify({ errors: [], data }),
});
