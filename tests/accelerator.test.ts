import { describe, expect, it } from 'vitest';

import { isValidAccelerator } from '../src/main/shortcuts/accelerator';

/**
 * The accelerator is typed by the user and globalShortcut.register() throws on a
 * malformed one, so this runs before Electron ever sees the string.
 */
describe('isValidAccelerator', () => {
  it('accepts ordinary combinations', () => {
    expect(isValidAccelerator('CommandOrControl+Alt+L')).toBe(true);
    expect(isValidAccelerator('Ctrl+Shift+F5')).toBe(true);
    expect(isValidAccelerator('Cmd+Shift+Space')).toBe(true);
    expect(isValidAccelerator('Alt+Up')).toBe(true);
  });

  it('requires a modifier', () => {
    // A bare letter would swallow that key across the whole system.
    expect(isValidAccelerator('L')).toBe(false);
    expect(isValidAccelerator('F5')).toBe(false);
  });

  it('rejects a chord that is still only modifiers', () => {
    expect(isValidAccelerator('Shift')).toBe(false);
    expect(isValidAccelerator('Ctrl+Shift')).toBe(false);
  });

  it('rejects junk rather than passing it to Electron', () => {
    expect(isValidAccelerator('')).toBe(false);
    expect(isValidAccelerator('+++')).toBe(false);
    expect(isValidAccelerator('DROP TABLE lights')).toBe(false);
    expect(isValidAccelerator('Ctrl+NotAKey')).toBe(false);
    expect(isValidAccelerator('Meh+L')).toBe(false);
  });

  it('accepts the function-key range but not beyond it', () => {
    expect(isValidAccelerator('Ctrl+F24')).toBe(true);
    expect(isValidAccelerator('Ctrl+F25')).toBe(false);
  });
});
