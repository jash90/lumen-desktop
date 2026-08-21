/**
 * Accelerator validation.
 *
 * The string comes from the user, and globalShortcut.register() throws on a
 * malformed one — so it is checked before it ever reaches Electron. A modifier
 * is required too: a bare letter would swallow that key system-wide, and on
 * macOS modifier-less shortcuts need Accessibility permission anyway.
 */

const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

const KEY = new RegExp(
  [
    '^(?:',
    '[0-9A-Za-z]',                                   // single character
    '|F(?:[1-9]|1\\d|2[0-4])',                       // F1-F24
    '|Plus|Space|Tab|Capslock|Numlock|Scrolllock',
    '|Backspace|Delete|Insert|Return|Enter|Escape|Esc',
    '|Up|Down|Left|Right|Home|End|PageUp|PageDown',
    '|num(?:[0-9]|dec|add|sub|mult|div)',
    ')$',
  ].join(''),
  'i',
);

export function isValidAccelerator(accelerator: string): boolean {
  const parts = accelerator.split('+').filter((part) => part.length > 0);
  if (parts.length < 2) return false;

  const key = parts[parts.length - 1]!;
  const modifiers = parts.slice(0, -1);

  if (modifiers.length === 0) return false;
  if (!modifiers.every((modifier) => MODIFIERS.has(modifier))) return false;
  // A modifier in the key position means the user is still mid-chord.
  if (MODIFIERS.has(key)) return false;

  return KEY.test(key);
}
