import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';

import { toSerializedError } from '../../shared/errors';
import {
  channelName,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type InvokeChannel,
  type Result,
} from '../../shared/ipc';

/**
 * IPC plumbing (PRD §16, §17, §33).
 *
 * Two rules hold everywhere below:
 *   1. a handler never throws across the boundary — failures come back as a typed
 *      Result so the renderer gets an error code and a human-readable message
 *      instead of Electron's mangled error string;
 *   2. every argument is validated, because the renderer is untrusted by design.
 */

type Handler = (...args: unknown[]) => Promise<unknown> | unknown;

const registered = new Set<InvokeChannel>();

export function handle<S extends z.ZodTypeAny, R>(
  channel: InvokeChannel,
  schema: S,
  fn: (input: z.infer<S>) => Promise<R> | R,
): void {
  registered.add(channel);
  ipcMain.handle(channelName(channel), async (_event, ...args): Promise<Result<R>> => {
    try {
      const input = schema.parse(args);
      return { ok: true, data: await fn(input) };
    } catch (error) {
      if (!(error instanceof z.ZodError)) {
        console.error(`[ipc] ${channel} failed:`, error);
      }
      return { ok: false, error: toSerializedError(error) };
    }
  });
}

/** Fails loudly at startup if a channel in the contract has no implementation. */
export function assertAllChannelsRegistered(): void {
  const missing = INVOKE_CHANNELS.filter((channel) => !registered.has(channel));
  if (missing.length > 0) {
    throw new Error(`IPC channels declared but not handled: ${missing.join(', ')}`);
  }
}

export function broadcast(channel: (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS], payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/** Argument schemas — deliberately strict about ranges the bridge would reject. */
const resourceId = z.string().min(1).max(128);

/**
 * One definition of what an Action may be, used both by the runAction channel
 * and by the shortcuts and quick actions stored in Settings. The renderer is
 * untrusted, so nothing here passes an unknown shape through.
 */
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('toggleLight'), id: resourceId }),
  z.object({ kind: z.literal('toggleRoom'), id: resourceId }),
  z.object({
    kind: z.literal('setRoomBrightness'),
    id: resourceId,
    brightness: z.number().min(0).max(100),
  }),
  z.object({ kind: z.literal('activateScene'), id: resourceId }),
  z.object({ kind: z.literal('allOff') }),
]);

export const args = {
  none: z.tuple([]).transform(() => undefined),
  id: z.tuple([z.string().min(1).max(128)]),
  ip: z.tuple([
    z
      .string()
      .regex(
        /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
        'expected an IPv4 address',
      ),
  ]),
  idAndBoolean: z.tuple([z.string().min(1).max(128), z.boolean()]),
  idAndPercent: z.tuple([z.string().min(1).max(128), z.number().min(0).max(100)]),
  settingsPatch: z.tuple([
    z.object({
      theme: z.enum(['system', 'light', 'dark']).optional(),
      launchAtLogin: z.boolean().optional(),
      shortcuts: z
        .array(z.object({ accelerator: z.string().min(1).max(64), action: actionSchema }))
        .max(10)
        .optional(),
      quickActions: z
        .array(
          z.object({
            id: resourceId,
            label: z.string().min(1).max(40),
            action: actionSchema,
          }),
        )
        .max(12)
        .optional(),
      // The renderer is untrusted, and settings.json is rewritten synchronously
      // on every change — hence the explicit shape and the cap.
      favorites: z
        .array(
          z.object({
            type: z.enum(['light', 'room', 'scene']),
            id: z.string().min(1).max(128),
          }),
        )
        .max(50)
        .optional(),
    }),
  ]),
  action: z.tuple([actionSchema]),
  idAndColor: z.tuple([
    z.string().min(1).max(128),
    z.object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255),
    }),
  ]),
};

export type Handlers = Record<string, Handler>;
