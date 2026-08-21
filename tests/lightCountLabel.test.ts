import { describe, expect, it } from 'vitest';

import { lightCountLabel } from '../src/renderer/lib/hue';

/**
 * Polish plurals are not a matter of taste here: RoomPage used to render
 * "2 lamp" because it carried its own simplified version of this rule.
 */
describe('lightCountLabel', () => {
  it('uses the singular for one', () => {
    expect(lightCountLabel(1)).toBe('1 lampa');
  });

  it('uses the "few" form for 2-4', () => {
    expect(lightCountLabel(2)).toBe('2 lampy');
    expect(lightCountLabel(3)).toBe('3 lampy');
    expect(lightCountLabel(4)).toBe('4 lampy');
  });

  it('uses the genitive plural from 5 up, and for zero', () => {
    expect(lightCountLabel(0)).toBe('0 lamp');
    expect(lightCountLabel(5)).toBe('5 lamp');
    expect(lightCountLabel(21)).toBe('21 lamp');
  });

  it('treats the teens as the exception they are', () => {
    // 12-14 look like the "few" range by their last digit but are not.
    expect(lightCountLabel(12)).toBe('12 lamp');
    expect(lightCountLabel(13)).toBe('13 lamp');
    expect(lightCountLabel(14)).toBe('14 lamp');
    expect(lightCountLabel(22)).toBe('22 lampy');
  });
});
