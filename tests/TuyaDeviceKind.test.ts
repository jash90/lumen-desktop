import { describe, expect, it } from 'vitest';

import { classifyDevice, describeKind } from '../src/main/tuya/TuyaDeviceKind';

/**
 * A Tuya device announces an id and nothing else — no class, no model. What it
 * is has to be read off the data points it reports.
 *
 * The bulb and the sensor below are the real shapes read off this network; the
 * metering socket is the shape that makes index-only matching wrong, since it
 * reports a voltage on the very index a bulb uses for its switch.
 */

describe('classifyDevice', () => {
  it('recognises a type B bulb', () => {
    // Read off the LED 13W RGB E-27 on this network.
    expect(
      classifyDevice({
        '20': false,
        '21': 'white',
        '22': 140,
        '23': 0,
        '24': '000003e803e8',
        '25': '000e0d0000000000000000c80000',
        '26': 0,
      }),
    ).toBe('light');
  });

  it('recognises a type A bulb on the low indices', () => {
    expect(
      classifyDevice({ '1': true, '2': 'white', '3': 200, '4': 0, '5': 'ff000000ffff' }),
    ).toBe('light');
  });

  /**
   * The case that makes matching on the index alone wrong: this socket reports
   * a voltage on 20, exactly where a type B bulb keeps its switch. Only the
   * value's type tells them apart.
   */
  it('does not mistake a metering socket for a bulb', () => {
    expect(
      classifyDevice({
        '1': true,
        '9': 0,
        '17': 12,
        '18': 430,
        '19': 950,
        '20': 2374,
        '21': 1,
        '22': 620,
      }),
    ).toBe('switch');
  });

  it('recognises a plain socket with nothing to dim', () => {
    expect(classifyDevice({ '1': false, '9': 0 })).toBe('switch');
  });

  it('recognises a sensor that only reports readings', () => {
    // The T & H sensor on this network: 29.2 degrees, 45 per cent, celsius.
    expect(classifyDevice({ '1': 292, '2': 45, '9': 'c' })).toBe('sensor');
  });

  it('treats a device that said nothing as unknown', () => {
    expect(classifyDevice({})).toBe('unknown');
  });

  it('does not guess at a shape it has never seen', () => {
    expect(classifyDevice({ '101': 'something', '102': 'else' })).toBe('unknown');
  });

  /** A switch on 20 with no lighting controls is still switchable, just not a light. */
  it('calls a bare boolean on 20 a switch', () => {
    expect(classifyDevice({ '20': true })).toBe('switch');
  });
});

describe('describeKind', () => {
  it('says something a user can act on', () => {
    expect(describeKind('sensor')).toMatch(/cannot be switched/);
    expect(describeKind('switch')).toMatch(/not a light/);
  });
});
