import { describe, expect, it } from 'vitest';

import { TuyaCommand } from '../src/main/tuya/TuyaCodec';
import {
  commandsFor,
  createFrameCodec,
  decodeFrames34,
  decodeFrames35,
  decodeGcmFrames,
  deriveSessionKey,
  encodeFrame34,
  encodeFrame35,
  negotiationFinishPayload,
  NewCommand,
  normaliseVersion,
  readNegotiationResponse,
  SessionCommand,
} from '../src/main/tuya/TuyaProtocol';
import vectors from './fixtures/tuya-protocol-vectors.json';

/**
 * Vectors come from an independent Python implementation of the 3.4 and 3.5
 * framing (the `cryptography` package, written after tinytuya's pack_message
 * and session negotiation), not from this code. Same fake key as the 3.3 tests.
 */
const KEY = Buffer.from('0123456789abcdef');
const LOCAL_NONCE = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
const REMOTE_NONCE = Buffer.from(Array.from({ length: 16 }, (_, i) => 100 + i));
const IV = Buffer.from('ABCDEFGHIJKL');
const OTHER_KEY = Buffer.from('fedcba9876543210');

const hex = (value: string): Buffer => Buffer.from(value, 'hex');

describe('normaliseVersion', () => {
  it('keeps the versions with their own protocol and folds the rest into 3.3', () => {
    expect(normaliseVersion('3.5')).toBe('3.5');
    expect(normaliseVersion('3.4')).toBe('3.4');
    expect(normaliseVersion('3.1')).toBe('3.3');
    expect(normaliseVersion(undefined)).toBe('3.3');
  });
});

describe('protocol 3.4', () => {
  const session = hex(vectors.v34.sessionKey);

  it('frames the negotiation start under the real key', () => {
    expect(encodeFrame34(SessionCommand.NEGOTIATE_START, 1, LOCAL_NONCE, KEY).toString('hex')).toBe(
      vectors.v34.negotiateStart,
    );
  });

  it('frames a device reply with its return code in the clear', () => {
    const proof = hex(vectors.v34.negotiateResponse);
    const { frames } = decodeFrames34(proof, KEY);
    expect(
      encodeFrame34(SessionCommand.NEGOTIATE_RESPONSE, 1, frames[0]!.payload, KEY, 0).toString(
        'hex',
      ),
    ).toBe(vectors.v34.negotiateResponse);
  });

  it('reads the device nonce and checks its proof of the key', () => {
    const { frames } = decodeFrames34(hex(vectors.v34.negotiateResponse), KEY);
    expect(frames[0]?.command).toBe(SessionCommand.NEGOTIATE_RESPONSE);
    expect(readNegotiationResponse(frames[0]!.payload, KEY, LOCAL_NONCE)).toEqual(REMOTE_NONCE);
  });

  it('finishes the negotiation byte for byte', () => {
    const finish = negotiationFinishPayload(KEY, REMOTE_NONCE);
    expect(encodeFrame34(SessionCommand.NEGOTIATE_FINISH, 2, finish, KEY).toString('hex')).toBe(
      vectors.v34.negotiateFinish,
    );
  });

  it('derives the same session key', () => {
    expect(deriveSessionKey('3.4', KEY, LOCAL_NONCE, REMOTE_NONCE).toString('hex')).toBe(
      vectors.v34.sessionKey,
    );
  });

  it('encrypts the version header together with a CONTROL_NEW body', () => {
    const frame = encodeFrame34(NewCommand.CONTROL_NEW, 3, Buffer.from(vectors.control), session);
    expect(frame.toString('hex')).toBe(vectors.v34.control);
  });

  it('sends DP_QUERY_NEW without the header', () => {
    expect(
      encodeFrame34(NewCommand.DP_QUERY_NEW, 4, Buffer.from('{}'), session).toString('hex'),
    ).toBe(vectors.v34.query);
  });

  it('reads a status push, stripping the return code and the header', () => {
    const { frames, rest } = decodeFrames34(hex(vectors.v34.statusPush), session);
    expect(rest.length).toBe(0);
    expect(frames[0]).toMatchObject({ command: TuyaCommand.STATUS, retcode: 0 });
    expect(frames[0]?.payload.toString()).toBe(vectors.status);
  });

  it('reports a key the device does not share as Unauthorized', () => {
    expect(() => decodeFrames34(hex(vectors.v34.statusPush), OTHER_KEY)).toThrow(/Unauthorized/);
  });

  it('holds back half a frame', () => {
    const whole = hex(vectors.v34.statusPush);
    const { frames, rest } = decodeFrames34(whole.subarray(0, 40), session);
    expect(frames).toHaveLength(0);
    expect(rest.length).toBe(40);
  });
});

describe('protocol 3.5', () => {
  const session = hex(vectors.v35.sessionKey);

  it('frames the negotiation start byte for byte', () => {
    expect(
      encodeFrame35(SessionCommand.NEGOTIATE_START, 1, LOCAL_NONCE, KEY, IV).toString('hex'),
    ).toBe(vectors.v35.negotiateStart);
  });

  it('reads the negotiation response', () => {
    const { frames } = decodeFrames35(hex(vectors.v35.negotiateResponse), KEY);
    expect(readNegotiationResponse(frames[0]!.payload, KEY, LOCAL_NONCE)).toEqual(REMOTE_NONCE);
  });

  it('derives the same session key', () => {
    expect(deriveSessionKey('3.5', KEY, LOCAL_NONCE, REMOTE_NONCE).toString('hex')).toBe(
      vectors.v35.sessionKey,
    );
  });

  it('encrypts CONTROL_NEW with the header inside', () => {
    expect(
      encodeFrame35(NewCommand.CONTROL_NEW, 3, Buffer.from(vectors.control), session, IV).toString(
        'hex',
      ),
    ).toBe(vectors.v35.control);
  });

  it('puts a device return code inside the ciphertext, ahead of the header', () => {
    expect(
      encodeFrame35(TuyaCommand.STATUS, 7, Buffer.from(vectors.status), session, IV, 0).toString(
        'hex',
      ),
    ).toBe(vectors.v35.statusPush);
  });

  it('reads a status push', () => {
    const { frames } = decodeFrames35(hex(vectors.v35.statusPush), session);
    expect(frames[0]).toMatchObject({ command: TuyaCommand.STATUS, retcode: 0 });
    expect(frames[0]?.payload.toString()).toBe(vectors.status);
  });

  it('rejects a frame whose tag does not verify', () => {
    const tampered = hex(vectors.v35.statusPush);
    tampered[30] = tampered[30]! ^ 0xff;
    expect(() => decodeFrames35(tampered, session)).toThrow(/Unauthorized/);
  });

  it('reads a UDP announcement, which carries no return code', () => {
    const udpKey = Buffer.from('6c1ec8e2bb9bb59ab50b0daf649b410a', 'hex');
    const { frames } = decodeGcmFrames(hex(vectors.v35.announcement), udpKey, 'detect');
    expect(frames[0]?.payload.toString()).toBe(vectors.v35.announcementJson);
  });
});

describe('createFrameCodec', () => {
  it('round-trips through the session key once it is set', () => {
    for (const version of ['3.4', '3.5'] as const) {
      const codec = createFrameCodec(version, '0123456789abcdef');
      const session = deriveSessionKey(version, KEY, LOCAL_NONCE, REMOTE_NONCE);
      codec.useSessionKey(session);

      // A query reply: no version header, and on 3.5 a return code up front.
      const encoded =
        version === '3.4'
          ? encodeFrame34(NewCommand.DP_QUERY_NEW, 9, Buffer.from('{"dps":{"20":true}}'), session)
          : encodeFrame35(
              NewCommand.DP_QUERY_NEW,
              9,
              Buffer.concat([Buffer.alloc(4), Buffer.from('{"dps":{"20":true}}')]),
              session,
            );
      const { frames } = codec.decode(encoded);
      expect(frames[0]?.payload.toString()).toBe('{"dps":{"20":true}}');
    }
  });

  it('keeps 3.3 byte-compatible with the existing codec', () => {
    const codec = createFrameCodec('3.3', '0123456789abcdef');
    const frame = codec.encode(TuyaCommand.HEART_BEAT, Buffer.from('{}'));
    expect(frame.toString('hex')).toBe(
      '000055aa000000010000000900000018cb70ddc25a2a2045b4c13084418a9abb48b041a90000aa55',
    );
  });
});

describe('commandsFor', () => {
  it('uses the new commands and body shape from 3.4 on', () => {
    const commands = commandsFor('3.5', 'dev1');
    expect(commands.query).toEqual({ command: NewCommand.DP_QUERY_NEW, body: {} });
    const control = commands.control({ '20': true });
    expect(control.command).toBe(NewCommand.CONTROL_NEW);
    expect(control.body).toMatchObject({ protocol: 5, data: { dps: { '20': true } } });
  });

  it('keeps the 3.3 shapes the bulbs here already answer', () => {
    const commands = commandsFor('3.3', 'dev1');
    expect(commands.query).toEqual({
      command: TuyaCommand.DP_QUERY,
      body: { gwId: 'dev1', devId: 'dev1' },
    });
    expect(commands.control({ '20': true }).body).toMatchObject({ devId: 'dev1', dps: { '20': true } });
  });
});
