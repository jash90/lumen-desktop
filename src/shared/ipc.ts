/**
 * The full contract between renderer and main (PRD §17).
 *
 * This file is the single source of truth for both sides: the preload script
 * builds `window.lumen` from INVOKE_CHANNELS, and the main process registers a
 * handler for every one of them. Adding a method here and forgetting the
 * handler is a compile error on the main side.
 */

import type { SerializedAppError } from './errors';
import type {
  Action,
  Automation,
  HubSummary,
  ConnectionStatus,
  DiscoveredBridge,
  Light,
  RgbColor,
  Room,
  Scene,
  Settings,
  StorageHealth,
} from './models';

/**
 * Handlers never throw across IPC — Electron flattens Error subclasses into
 * opaque strings, which would leak technical detail and lose the error code.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: SerializedAppError };

/** Pairing state machine (PRD §40) — drives the whole onboarding UI. */
export type PairingState =
  | { status: 'idle' }
  | { status: 'discovering' }
  | { status: 'discovered'; bridges: DiscoveredBridge[] }
  | { status: 'waitingForButton'; ip: string; secondsLeft: number }
  | { status: 'pairing'; ip: string }
  | { status: 'connected'; hub: HubSummary }
  | { status: 'failed'; error: SerializedAppError };

/** Allowlist of invokable channels. The preload exposes nothing outside this list. */
export const INVOKE_CHANNELS = [
  'getVersion',
  'discoverBridges',
  'pairBridge',
  'cancelPairing',
  'connectHomeAssistant',
  'reconnectHubs',
  'getConnectionStatuses',
  'getStorageHealth',
  'listHubs',
  'removeHub',
  'getSettings',
  'setSettings',
  'getLights',
  'getLight',
  'setLightPower',
  'setLightBrightness',
  'setLightColor',
  'setLightTemperature',
  'getRooms',
  'getRoom',
  'setRoomPower',
  'setRoomBrightness',
  'getScenes',
  'activateScene',
  'getAutomations',
  'setAutomationEnabled',
  'runAction',
  'getShortcutConflicts',
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = {
  lightChanged: 'lumen:lightChanged',
  roomChanged: 'lumen:roomChanged',
  connectionChanged: 'lumen:connectionChanged',
  pairingState: 'lumen:pairingState',
} as const;

export const channelName = (channel: InvokeChannel): string => `lumen:${channel}`;

export type Unsubscribe = () => void;

/**
 * `window.lumen` as the renderer sees it. Deliberately flat, mirroring PRD §16 —
 * no ipcRenderer, no Node primitives, no application key.
 */
export interface LumenApi {
  getVersion(): Promise<Result<string>>;

  // Hubs
  discoverBridges(): Promise<Result<DiscoveredBridge[]>>;
  /** Runs the full link-button ceremony; progress arrives via onPairingState. */
  pairBridge(ip: string): Promise<Result<HubSummary>>;
  cancelPairing(): Promise<Result<void>>;
  /** Home Assistant needs no ceremony — a URL and a long-lived token is all. */
  connectHomeAssistant(input: {
    baseUrl: string;
    token: string;
    name?: string;
  }): Promise<Result<HubSummary>>;

  // Every configured hub is connected at once, so the state is a list rather
  // than one value. No key or token ever crosses this boundary.
  listHubs(): Promise<Result<HubSummary[]>>;
  getConnectionStatuses(): Promise<Result<ConnectionStatus[]>>;
  reconnectHubs(): Promise<Result<ConnectionStatus[]>>;
  removeHub(id: string): Promise<Result<void>>;
  getStorageHealth(): Promise<Result<StorageHealth>>;

  // Preferences (PRD §29). Kept in the main process rather than localStorage so
  // the setting survives regardless of how the renderer origin is treated.
  getSettings(): Promise<Result<Settings>>;
  setSettings(patch: Partial<Settings>): Promise<Result<Settings>>;

  // Lights
  getLights(): Promise<Result<Light[]>>;
  getLight(id: string): Promise<Result<Light>>;
  setLightPower(id: string, on: boolean): Promise<Result<void>>;
  /** 0–100 %. 0 switches the light off rather than sending an invalid level. */
  setLightBrightness(id: string, brightness: number): Promise<Result<void>>;
  setLightColor(id: string, color: RgbColor): Promise<Result<void>>;
  /** 0–100 where 0 = warmest, 100 = coldest. */
  setLightTemperature(id: string, temperature: number): Promise<Result<void>>;

  // Rooms
  getRooms(): Promise<Result<Room[]>>;
  getRoom(id: string): Promise<Result<Room>>;
  setRoomPower(id: string, on: boolean): Promise<Result<void>>;
  setRoomBrightness(id: string, brightness: number): Promise<Result<void>>;

  // Scenes. Recalling one produces ordinary light events, so the UI updates
  // through the same stream as any other change.
  getScenes(): Promise<Result<Scene[]>>;
  activateScene(id: string): Promise<Result<void>>;

  // Automations created in the Hue app: read and toggle, nothing more.
  getAutomations(): Promise<Result<Automation[]>>;
  setAutomationEnabled(id: string, enabled: boolean): Promise<Result<void>>;

  // Actions — the same commands the tray and global shortcuts issue.
  runAction(action: Action): Promise<Result<void>>;
  /**
   * Accelerators the OS refused, so the settings screen can say so instead of
   * leaving the user with a shortcut that silently does nothing.
   */
  getShortcutConflicts(): Promise<Result<string[]>>;

  // Push updates (PRD §50) — renderer only ever learns about these three.
  onLightChanged(listener: (lights: Light[]) => void): Unsubscribe;
  onRoomChanged(listener: (rooms: Room[]) => void): Unsubscribe;
  onConnectionChanged(listener: (statuses: ConnectionStatus[]) => void): Unsubscribe;
  onPairingState(listener: (state: PairingState) => void): Unsubscribe;
}

declare global {
  interface Window {
    lumen: LumenApi;
  }
}
