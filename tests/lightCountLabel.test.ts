import { afterEach, describe, expect, it } from 'vitest';

import { lightCountLabel } from '../src/renderer/lib/api';
import { setLocale } from '../src/shared/i18n';

/**
 * Shared by RoomCard and RoomPage, which used to carry their own copies — one of
 * them got the Polish label wrong ("2 lamp" instead of "2 lampy").
 */
describe('lightCountLabel', () => {
  afterEach(() => setLocale('en'));

  it('uses the singular for one', () => {
    expect(lightCountLabel(1)).toBe('1 light');
  });

  it('uses the plural for everything else, zero included', () => {
    expect(lightCountLabel(0)).toBe('0 lights');
    expect(lightCountLabel(2)).toBe('2 lights');
    expect(lightCountLabel(12)).toBe('12 lights');
  });

  it('follows the three Polish forms, teens included', () => {
    setLocale('pl');
    expect(lightCountLabel(1)).toBe('1 lampa');
    expect(lightCountLabel(2)).toBe('2 lampy');
    expect(lightCountLabel(4)).toBe('4 lampy');
    expect(lightCountLabel(5)).toBe('5 lamp');
    expect(lightCountLabel(12)).toBe('12 lamp');
    expect(lightCountLabel(14)).toBe('14 lamp');
    expect(lightCountLabel(22)).toBe('22 lampy');
    expect(lightCountLabel(25)).toBe('25 lamp');
    expect(lightCountLabel(0)).toBe('0 lamp');
  });
});
