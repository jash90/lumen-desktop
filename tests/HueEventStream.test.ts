import { describe, expect, it } from 'vitest';

import { parseSseChunk } from '../src/main/hue/HueEventStream';

describe('parseSseChunk', () => {
  it('extracts complete events and keeps the partial tail buffered', () => {
    const chunk = 'id: 1\ndata: [{"type":"update"}]\n\ndata: [{"type":"upd';
    const { events, rest } = parseSseChunk(chunk);

    expect(events).toEqual(['[{"type":"update"}]']);
    expect(rest).toBe('data: [{"type":"upd');
  });

  it('reassembles an event split across chunks', () => {
    const first = parseSseChunk('data: [{"a":');
    expect(first.events).toEqual([]);

    const second = parseSseChunk(`${first.rest}1}]\n\n`);
    expect(second.events).toEqual(['[{"a":1}]']);
    expect(second.rest).toBe('');
  });

  it('joins multi-line data payloads', () => {
    const { events } = parseSseChunk('data: [{"a":\ndata: 1}]\n\n');
    expect(events).toEqual(['[{"a":1}]']);
  });

  it('ignores keep-alive frames that carry no data', () => {
    const { events } = parseSseChunk(': keep-alive\n\n');
    expect(events).toEqual([]);
  });
});

describe('backoff', () => {
  it('follows the PRD §25 schedule and caps at the last step', async () => {
    const { backoffDelay } = await import('../src/main/backoff');

    expect([0, 1, 2, 3, 4].map(backoffDelay)).toEqual([1_000, 2_000, 5_000, 10_000, 30_000]);
    // Past the end it must hold at 30 s rather than run off the array.
    expect(backoffDelay(5)).toBe(30_000);
    expect(backoffDelay(99)).toBe(30_000);
    expect(backoffDelay(-1)).toBe(1_000);
  });
});
