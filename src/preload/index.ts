import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  channelName,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type HueApi,
  type Unsubscribe,
} from '../shared/ipc';

/**
 * The only bridge between renderer and main (PRD §16, §33).
 *
 * The renderer receives `window.hue` and nothing else — no ipcRenderer, no fs, no
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

const api = {
  ...invoke,
  onLightChanged: (listener) => subscribe(EVENT_CHANNELS.lightChanged, listener),
  onRoomChanged: (listener) => subscribe(EVENT_CHANNELS.roomChanged, listener),
  onConnectionChanged: (listener) => subscribe(EVENT_CHANNELS.connectionChanged, listener),
  onPairingState: (listener) => subscribe(EVENT_CHANNELS.pairingState, listener),
} as HueApi;

contextBridge.exposeInMainWorld('hue', api);
