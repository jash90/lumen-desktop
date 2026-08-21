import { globalShortcut } from 'electron';

import type { Action, Shortcut } from '../../shared/models';
import { isValidAccelerator } from './accelerator';

/**
 * Global shortcuts, with the failure mode that matters made visible.
 *
 * globalShortcut.register() returns false when the combination is already taken
 * by the system or another app — silently. Without reporting that back, the user
 * sets a shortcut, nothing happens, and there is nothing to explain why.
 */
export interface ShortcutRegistrar {
  /** Registers the given set, returning the accelerators that could not be taken. */
  apply(shortcuts: readonly Shortcut[]): string[];
  dispose(): void;
}

export function createShortcutRegistrar(run: (action: Action) => void): ShortcutRegistrar {
  return {
    apply(shortcuts) {
      // Without this a changed shortcut would leave the old one live.
      globalShortcut.unregisterAll();

      const failed: string[] = [];
      for (const shortcut of shortcuts) {
        if (!isValidAccelerator(shortcut.accelerator)) {
          failed.push(shortcut.accelerator);
          continue;
        }
        try {
          const ok = globalShortcut.register(shortcut.accelerator, () => run(shortcut.action));
          if (!ok) failed.push(shortcut.accelerator);
        } catch (error) {
          console.warn(`[shortcuts] ${shortcut.accelerator} rejected:`, error);
          failed.push(shortcut.accelerator);
        }
      }
      return failed;
    },

    dispose() {
      globalShortcut.unregisterAll();
    },
  };
}
