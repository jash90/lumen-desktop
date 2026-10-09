import { describe, expect, it, vi } from 'vitest';

import { fetchCloudDevices, signRequest } from '../src/main/tuya/TuyaCloud';

/**
 * Signatures were computed with Python's hmac/hashlib from Tuya's published
 * formula, not with this code.
 */
const ACCESS_ID = 'abcd1234efgh5678';
const SECRET = '0123456789abcdef0123456789abcdef';
const T = 1_700_000_000_000;

describe('signRequest', () => {
  it('signs the token request', () => {
    expect(
      signRequest({
        accessId: ACCESS_ID,
        accessSecret: SECRET,
        t: String(T),
        method: 'GET',
        pathWithQuery: '/v1.0/token?grant_type=1',
      }),
    ).toBe('A9BB93454AF6CDFAA2F1EFC035F08B0DF35F08D21B7D069B847E61330C0122F4');
  });

  it('includes the access token once there is one', () => {
    expect(
      signRequest({
        accessId: ACCESS_ID,
        accessSecret: SECRET,
        token: 'tok123',
        t: String(T),
        method: 'GET',
        pathWithQuery: '/v1.0/iot-01/associated-users/devices?last_row_key=abc&size=50',
      }),
    ).toBe('CB9F7B526A13151E1D237D0F4943BE6C5E10BBD675A5233525F4C5E07AC22B25');
  });
});

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('fetchCloudDevices', () => {
  const credentials = { region: 'eu' as const, accessId: ACCESS_ID, accessSecret: SECRET };

  it('gets a token, then pages through the devices', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply({ success: true, result: { access_token: 'tok123' } }))
      .mockResolvedValueOnce(
        reply({
          success: true,
          result: {
            devices: [
              { id: 'bf01', name: ' Desk lamp ', local_key: 'k'.repeat(16), category: 'dj' },
              // No key: a device shared to the account rather than owned. Skipped.
              { id: 'bf02', name: 'Shared plug' },
            ],
            has_more: true,
            last_row_key: 'abc',
          },
        }),
      )
      .mockResolvedValueOnce(
        reply({
          success: true,
          result: {
            devices: [{ id: 'bf03', name: '', local_key: 'q'.repeat(16), product_name: 'Strip' }],
            has_more: false,
          },
        }),
      );

    const devices = await fetchCloudDevices(credentials, fetch, () => T);

    expect(devices).toEqual([
      {
        deviceId: 'bf01',
        name: 'Desk lamp',
        localKey: 'k'.repeat(16),
        category: 'dj',
        productName: '',
      },
      { deviceId: 'bf03', name: 'bf03', localKey: 'q'.repeat(16), category: '', productName: 'Strip' },
    ]);

    const [url, init] = fetch.mock.calls[2]!;
    expect(url).toBe(
      'https://openapi.tuyaeu.com/v1.0/iot-01/associated-users/devices?last_row_key=abc&size=50',
    );
    expect(init.headers).toMatchObject({
      client_id: ACCESS_ID,
      access_token: 'tok123',
      sign_method: 'HMAC-SHA256',
      sign: 'CB9F7B526A13151E1D237D0F4943BE6C5E10BBD675A5233525F4C5E07AC22B25',
    });
  });

  it('reports a rejected token as a credentials problem', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ success: false, code: 1004, msg: 'sign invalid' }));
    await expect(fetchCloudDevices(credentials, fetch, () => T)).rejects.toMatchObject({
      code: 'CloudUnauthorized',
    });
  });

  it('reports a project that may not list devices as a permissions problem', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply({ success: true, result: { access_token: 'tok123' } }))
      .mockResolvedValueOnce(reply({ success: false, code: 28841105, msg: 'No permissions' }));
    await expect(fetchCloudDevices(credentials, fetch, () => T)).rejects.toMatchObject({
      code: 'CloudPermission',
    });
  });

  it('reports a network failure as one', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(fetchCloudDevices(credentials, fetch, () => T)).rejects.toMatchObject({
      code: 'NetworkError',
    });
  });
});
