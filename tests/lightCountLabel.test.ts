import { describe, expect, it } from 'vitest';

import { lightCountLabel } from '../src/renderer/lib/hue';

/**
 * Shared by RoomCard and RoomPage, which used to carry their own copies — one of
 * them got the label wrong.
 */
describe('lightCountLabel', () => {
  it('uses the singular for one', () => {
    expect(lightCountLabel(1)).toBe('1 light');
  });

  it('uses the plural for everything else, zero included', () => {
    expect(lightCountLabel(0)).toBe('0 lights');
    expect(lightCountLabel(2)).toBe('2 lights');
    expect(lightCountLabel(12)).toBe('12 lights');
  });
});
