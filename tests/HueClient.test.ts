import { describe, expect, it } from 'vitest';

import { HueError } from '../src/shared/errors';
import { lightDtoSchema } from '../src/main/hue/dto';
import { createHueClient } from '../src/main/hue/HueClient';
import { mapTransportError } from '../src/main/hue/HueTransport';
import { createFakeTransport, jsonResponse } from './fakeTransport';
import { CEILING_LIGHT, PLAIN_LIGHT } from './fixtures';

/** Integration scenarios from PRD §34, driven through a fake bridge. */

const APP_KEY = 'test-application-key';

describe('HueClient', () => {
  it('GET lights returns parsed resources and sends the application key', async () => {
    const transport = createFakeTransport(() => jsonResponse([CEILING_LIGHT, PLAIN_LIGHT]));
    const client = createHueClient(transport, APP_KEY);

    const lights = await client.list('light', lightDtoSchema);

    expect(lights).toHaveLength(2);
    expect(lights[0]?.metadata.name).toBe('Sufit');
    expect(transport.calls[0]?.path).toBe('/clip/v2/resource/light');
    expect(transport.calls[0]?.headers?.['hue-application-key']).toBe(APP_KEY);
  });

  it('PUT light state sends the body to the right resource', async () => {
    const transport = createFakeTransport(() => jsonResponse([{ rid: 'light-ceiling' }]));
    const client = createHueClient(transport, APP_KEY);

    await client.update('light', 'light-ceiling', { on: { on: true } });

    const call = transport.calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe('/clip/v2/resource/light/light-ceiling');
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ on: { on: true } });
  });

  it('maps 401 to Unauthorized rather than a generic failure', async () => {
    const transport = createFakeTransport(() => ({ status: 401, body: 'unauthorized user' }));
    const client = createHueClient(transport, APP_KEY);

    await expect(client.list('light', lightDtoSchema)).rejects.toMatchObject({
      code: 'Unauthorized',
    });
  });

  it('reports a malformed response instead of throwing a JSON syntax error', async () => {
    const transport = createFakeTransport(() => ({ status: 200, body: '<html>nope</html>' }));
    const client = createHueClient(transport, APP_KEY);

    const error = await client.list('light', lightDtoSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HueError);
    expect((error as HueError).code).toBe('RequestFailed');
  });

  it('surfaces per-resource errors that arrive with HTTP 200', async () => {
    const transport = createFakeTransport(() => ({
      status: 200,
      body: JSON.stringify({ errors: [{ description: 'device is not responding' }], data: [] }),
    }));
    const client = createHueClient(transport, APP_KEY);

    await expect(client.list('light', lightDtoSchema)).rejects.toMatchObject({
      code: 'RequestFailed',
    });
  });

  it('skips one unparsable resource rather than blanking the whole list', async () => {
    const transport = createFakeTransport(() =>
      jsonResponse([CEILING_LIGHT, { id: 'broken', nothing: true }]),
    );
    const client = createHueClient(transport, APP_KEY);

    const lights = await client.list('light', lightDtoSchema);
    expect(lights.map((light) => light.id)).toEqual(['light-ceiling']);
  });
});

describe('mapTransportError', () => {
  it('turns an offline bridge into BridgeOffline, never ECONNREFUSED', () => {
    const error = mapTransportError(Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    }));

    expect(error.code).toBe('BridgeOffline');
    expect(error.userMessage).toBe('Nie udało się połączyć z Hue Bridge.');
    expect(error.userMessage).not.toContain('ECONNREFUSED');
  });

  it('classifies TLS failures separately from network failures', () => {
    expect(
      mapTransportError(
        Object.assign(new Error('bad cert'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
      ).code,
    ).toBe('CertificateError');
    expect(
      mapTransportError(Object.assign(new Error('cn'), { code: 'HUE_CN_MISMATCH' })).code,
    ).toBe('CertificateError');
    expect(
      mapTransportError(Object.assign(new Error('dns'), { code: 'ENOTFOUND' })).code,
    ).toBe('NetworkError');
  });

  it('passes an existing HueError through unchanged', () => {
    const original = new HueError('PairingTimeout');
    expect(mapTransportError(original)).toBe(original);
  });
});
