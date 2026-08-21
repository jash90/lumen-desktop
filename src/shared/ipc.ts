/**
 * The full contract between renderer and main (PRD §17).
 *
 * This file is the single source of truth for both sides: the preload script
 * builds `window.hue` from INVOKE_CHANNELS, and the main process registers a
 * handler for every one of them. Adding a method here and forgetting the
 * handler is a compile error on the main side.
 */

import type { SerializedHueError } from './errors';
import type {
  Action,
  Automation,
  BridgeSummary,
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
export type Result<T> = { ok: true; data: T } | { ok: false; error: SerializedHueError };

/** Pairing state machine (PRD §40) — drives the whole onboarding UI. */
export type PairingState =
  | { status: 'idle' }
  | { status: 'discovering' }
  | { status: 'discovered'; bridges: DiscoveredBridge[] }
  | { status: 'waitingForButton'; ip: string; secondsLeft: number }
  | { status: 'pairing'; ip: string }
  | { status: 'connected'; bridge: BridgeSummary }
  | { status: 'failed'; error: SerializedHueError };

/** Allowlist of invokable channels. The preload exposes nothing outside this list. */
export const INVOKE_CHANNELS = [
  'getVersion',
  'discoverBridges',
  'pairBridge',
  'cancelPairing',
  'getBridge',
  'disconnectBridge',
  'reconnectBridge',
  'getConnectionStatus',
  'getStorageHealth',
  'listBridges',
  'setActiveBridge',
  'removeBridge',
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
  lightChanged: 'hue:lightChanged',
  roomChanged: 'hue:roomChanged',
  connectionChanged: 'hue:connectionChanged',
  pairingState: 'hue:pairingState',
} as const;

export const channelName = (channel: InvokeChannel): string => `hue:${channel}`;

export type Unsubscribe = () => void;

/**
 * `window.hue` as the renderer sees it. Deliberately flat, mirroring PRD §16 —
 * no ipcRenderer, no Node primitives, no application key.
 */
export interface HueApi {
  getVersion(): Promise<Result<string>>;

  // Bridge
  discoverBridges(): Promise<Result<DiscoveredBridge[]>>;
  /** Runs the full link-button ceremony; progress arrives via onPairingState. */
  pairBridge(ip: string): Promise<Result<BridgeSummary>>;
  cancelPairing(): Promise<Result<void>>;
  getBridge(): Promise<Result<BridgeSummary | null>>;
  disconnectBridge(): Promise<Result<void>>;
  reconnectBridge(): Promise<Result<ConnectionStatus>>;
  getConnectionStatus(): Promise<Result<ConnectionStatus>>;
  getStorageHealth(): Promise<Result<StorageHealth>>;

  // Multiple bridges: one is active at a time and the app switches between them.
  // The application key never crosses this boundary.
  listBridges(): Promise<Result<BridgeSummary[]>>;
  setActiveBridge(id: string): Promise<Result<ConnectionStatus>>;
  removeBridge(id: string): Promise<Result<void>>;

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
  onConnectionChanged(listener: (status: ConnectionStatus) => void): Unsubscribe;
  onPairingState(listener: (state: PairingState) => void): Unsubscribe;
}

declare global {
  interface Window {
    hue: HueApi;
  }
}
