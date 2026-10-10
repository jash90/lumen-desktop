import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  channelName,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  LOCALE_CHANNEL,
  type LumenApi,
  type Unsubscribe,
} from '../shared/ipc';
import { DEFAULT_LOCALE, isLocale } from '../shared/i18n/locale';

/**
 * The only bridge between renderer and main (PRD §16, §33).
 *
 * The renderer receives `window.lumen` and nothing else — no ipcRenderer, no fs, no
 * Node globals. Because the surface is generated from INVOKE_CHANNELS, a channel
 * that is not in the contract simply cannot be called from the UI.
 */

const invoke = Object.fromEntries(
  INVOKE_CHANNELS.map((channel) => [
    channel,
    (...args: unknown[]) => ipcRenderer.invoke(channelName(channel), ...args),
  ]),
);

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.off(channel, wrapped);
  };
}

const locale: unknown = ipcRenderer.sendSync(LOCALE_CHANNEL);

const api = {
  ...invoke,
  locale: isLocale(locale) ? locale : DEFAULT_LOCALE,
  onLightChanged: (listener) => subscribe(EVENT_CHANNELS.lightChanged, listener),
  onRoomChanged: (listener) => subscribe(EVENT_CHANNELS.roomChanged, listener),
  onConnectionChanged: (listener) => subscribe(EVENT_CHANNELS.connectionChanged, listener),
  onPairingState: (listener) => subscribe(EVENT_CHANNELS.pairingState, listener),
  onUpdateStatus: (listener) => subscribe(EVENT_CHANNELS.updateStatus, listener),
} as LumenApi;

contextBridge.exposeInMainWorld('lumen', api);
