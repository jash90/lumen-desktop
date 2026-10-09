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

/**
 * Where the in-app update stands. `ready` means downloaded and waiting for a
 * restart; `available` is the Linux case, where the app can only point at the
 * release because a .deb or .rpm cannot replace itself.
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported' }
  | { state: 'checking' }
  | { state: 'downloading' }
  | { state: 'ready'; version: string }
  | { state: 'available'; version: string; url: string }
  | { state: 'upToDate' }
  | { state: 'error'; message: string };

/** Allowlist of invokable channels. The preload exposes nothing outside this list. */
export const INVOKE_CHANNELS = [
  'getVersion',
  'discoverBridges',
  'pairBridge',
  'cancelPairing',
  'connectHomeAssistant',
  'discoverTuyaDevices',
  'connectTuya',
  'fetchTuyaCloudDevices',
  'scanTuyaNetwork',
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
  'getUpdateStatus',
  'checkForUpdates',
  'installUpdate',
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = {
  lightChanged: 'lumen:lightChanged',
  roomChanged: 'lumen:roomChanged',
  connectionChanged: 'lumen:connectionChanged',
  pairingState: 'lumen:pairingState',
  updateStatus: 'lumen:updateStatus',
} as const;

export const channelName = (channel: InvokeChannel): string => `lumen:${channel}`;

/** What discovery can say about a device before anyone has its local key. */
export interface DiscoveredTuyaSummary {
  deviceId: string;
  address: string;
  version: string;
  name?: string;
  /** Already part of the stored Tuya hub. */
  connected?: boolean;
}

/** Tuya Cloud data centers; a project lives in exactly one. */
export const TUYA_REGIONS = {
  eu: 'Central Europe',
  'eu-west': 'Western Europe',
  us: 'Western America',
  'us-east': 'Eastern America',
  cn: 'China',
  in: 'India',
  sg: 'Singapore',
} as const;

export type TuyaRegion = keyof typeof TUYA_REGIONS;

/** A device as the Tuya Cloud lists it — without its key, which stays in main. */
export interface TuyaCloudDeviceSummary {
  deviceId: string;
  name: string;
  productName: string;
  /** Pre-selection only; the device is still asked what it is on connect. */
  isLight: boolean;
}

export interface TuyaScanResult {
  found: { deviceId: string; address: string; version: string }[];
  /** Answered on the Tuya port, but to none of the keys tried. */
  unidentified: string[];
}

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
  /**
   * Listens for the announcements Tuya devices broadcast. Deliberately
   * re-runnable: a device that stayed quiet in one pass turns up in the next.
   */
  discoverTuyaDevices(): Promise<Result<DiscoveredTuyaSummary[]>>;
  /**
   * Each device carries its own local key; there is no hub in front of them.
   *
   * Only the ones that turn out to be lights are kept — a Tuya device says
   * nothing about what it is until it answers — and the rest come back in
   * `skipped` so the form can say which and why.
   */
  connectTuya(input: {
    devices: {
      deviceId: string;
      name: string;
      address: string;
      /** Omitted when it came from the Tuya Cloud; main still holds it. */
      localKey?: string;
      /** As discovered; absent means 3.3. */
      version?: string;
    }[];
  }): Promise<Result<HubSummary & { skipped: { name: string; reason: string }[] }>>;
  /**
   * Names and local keys from the user's Tuya IoT project, read once. The keys
   * stay in the main process; only names come back. The secret is not stored.
   */
  fetchTuyaCloudDevices(input: {
    region: TuyaRegion;
    accessId: string;
    accessSecret: string;
  }): Promise<Result<TuyaCloudDeviceSummary[]>>;
  /**
   * Tries addresses instead of waiting for broadcasts: the local network when
   * `target` is empty, or one address or range. Devices are recognised by the
   * keys given plus any from the cloud.
   */
  scanTuyaNetwork(input: {
    target?: string;
    keys: { deviceId: string; localKey: string }[];
  }): Promise<Result<TuyaScanResult>>;

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

  // Updates. Checking happens only when asked; progress arrives via onUpdateStatus.
  getUpdateStatus(): Promise<Result<UpdateStatus>>;
  checkForUpdates(): Promise<Result<UpdateStatus>>;
  /** Restarts into a downloaded update, or opens the release page on Linux. */
  installUpdate(): Promise<Result<void>>;

  // Push updates (PRD §50) — renderer only ever learns about these three.
  onLightChanged(listener: (lights: Light[]) => void): Unsubscribe;
  onRoomChanged(listener: (rooms: Room[]) => void): Unsubscribe;
  onConnectionChanged(listener: (statuses: ConnectionStatus[]) => void): Unsubscribe;
  onPairingState(listener: (state: PairingState) => void): Unsubscribe;
  onUpdateStatus(listener: (status: UpdateStatus) => void): Unsubscribe;
}

declare global {
  interface Window {
    lumen: LumenApi;
  }
}
