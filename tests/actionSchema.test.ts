import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

const { actionSchema } = await import('../src/main/ipc/handlers');

/**
 * runAction is a broad surface reachable from the untrusted renderer, so the
 * schema is the thing standing between it and the bridge.
 */
describe('actionSchema', () => {
  it('accepts the actions the app actually issues', () => {
    expect(actionSchema.safeParse({ kind: 'allOff' }).success).toBe(true);
    expect(actionSchema.safeParse({ kind: 'toggleRoom', id: 'room-1' }).success).toBe(true);
    expect(
      actionSchema.safeParse({ kind: 'setRoomBrightness', id: 'room-1', brightness: 40 }).success,
    ).toBe(true);
  });

  it('rejects an unknown kind instead of letting it through', () => {
    expect(actionSchema.safeParse({ kind: 'deleteEverything', id: 'x' }).success).toBe(false);
  });

  it('keeps brightness inside the domain range', () => {
    expect(
      actionSchema.safeParse({ kind: 'setRoomBrightness', id: 'r', brightness: 200 }).success,
    ).toBe(false);
    expect(
      actionSchema.safeParse({ kind: 'setRoomBrightness', id: 'r', brightness: -1 }).success,
    ).toBe(false);
  });

  it('rejects a missing or oversized id', () => {
    expect(actionSchema.safeParse({ kind: 'toggleRoom' }).success).toBe(false);
    expect(actionSchema.safeParse({ kind: 'toggleRoom', id: '' }).success).toBe(false);
    expect(actionSchema.safeParse({ kind: 'toggleRoom', id: 'x'.repeat(200) }).success).toBe(false);
  });

  it('strips anything extra rather than forwarding it to the bridge', () => {
    const parsed = actionSchema.parse({
      kind: 'toggleRoom',
      id: 'room-1',
      on: { on: true },
      dimming: { brightness: 100 },
    });

    expect(parsed).toEqual({ kind: 'toggleRoom', id: 'room-1' });
  });
});
