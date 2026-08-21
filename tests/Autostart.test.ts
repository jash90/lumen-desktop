import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { setLoginItemSettings: vi.fn() } }));

const { HIDDEN_FLAG, loginItemSettingsFor } = await import('../src/main/autostart');

/**
 * The rules differ per platform in ways that are easy to get wrong and hard to
 * notice — a broken Windows entry only shows up after the next update.
 */
describe('loginItemSettingsFor', () => {
  it('points Windows at Update.exe, not at the versioned executable', () => {
    const plan = loginItemSettingsFor(
      'win32',
      true,
      'C:\\Users\\x\\AppData\\Local\\hue\\app-0.2.1\\hue-desktop.exe',
    );

    // The app-0.2.1 folder is replaced on update; Update.exe is not.
    expect(plan.settings?.path).toMatch(/Update\.exe$/);
    expect(plan.settings?.path).not.toContain('app-0.2.1');
    expect(plan.settings?.args).toContain('--processStart');
    expect(plan.settings?.openAtLogin).toBe(true);
  });

  it('asks macOS to start us with the hidden flag', () => {
    // openAsHidden is ignored on macOS 13+, so the flag carries the intent.
    const plan = loginItemSettingsFor('darwin', true, '/Applications/Hue Desktop.app');

    expect(plan.supported).toBe(true);
    expect(plan.settings).toEqual({ openAtLogin: true, args: [HIDDEN_FLAG] });
  });

  it('reports Linux as unsupported so the caller writes a desktop entry instead', () => {
    const plan = loginItemSettingsFor('linux', true, '/usr/bin/hue-desktop');

    expect(plan.supported).toBe(false);
    expect(plan.settings).toBeUndefined();
  });

  it('carries the disabled state through rather than dropping the call', () => {
    expect(loginItemSettingsFor('darwin', false, '/x').settings?.openAtLogin).toBe(false);
    expect(loginItemSettingsFor('win32', false, 'C:\\x\\app-1\\y.exe').settings?.openAtLogin).toBe(
      false,
    );
  });
});
