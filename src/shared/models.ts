/**
 * Domain model exposed to the renderer (PRD §31).
 *
 * The renderer never sees Hue API DTOs, mirek, CIE xy or application keys —
 * only these types. Swapping the Hue API version must not reach the UI.
 */

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/** Which controls a bulb actually supports (PRD §63.4 — UI is capability-driven). */
export interface LightCapabilities {
  dimming: boolean;
  colorTemperature: boolean;
  color: boolean;
}

/** sRGB, 0–255 per channel. */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface Light {
  id: string;
  name: string;
  /** Room the owning device belongs to; null for lights outside any room. */
  roomId: string | null;
  isOn: boolean;
  /** 0–100 %. Reports the last set level even while off. */
  brightness: number;
  color?: RgbColor;
  /** 0–100 where 0 = warmest, 100 = coldest. Hue's mirek stays in the main process. */
  colorTemperature?: number;
  capabilities: LightCapabilities;
}

export interface Room {
  id: string;
  name: string;
  lightIds: string[];
  /** true when any member light is on — matches how the Hue app reports a room. */
  isOn: boolean;
  /** 0–100 %, averaged over the lights that are on. */
  brightness: number;
  /** false when the room has no grouped_light service and must be driven per light. */
  supportsGroupControl: boolean;
}

/**
 * A lighting preset stored on the bridge (PRD roadmap v1).
 *
 * `roomId` is null for scenes attached to a zone rather than a room — the app
 * has no zone concept, and dropping them would make them unreachable.
 */
export interface Scene {
  id: string;
  name: string;
  roomId: string | null;
  /** True while the bridge reports this scene as the one currently applied. */
  isActive: boolean;
}

export interface BridgeSummary {
  id: string;
  name: string;
  ip: string;
  modelId?: string;
  swVersion?: string;
}

export type DiscoverySource = 'mdns' | 'cloud' | 'cache' | 'manual';

export interface DiscoveredBridge {
  id: string;
  ip: string;
  name?: string;
  source: DiscoverySource;
}

export interface ConnectionStatus {
  state: ConnectionState;
  bridge: BridgeSummary | null;
  /** Set while state is 'reconnecting'; ms until the next attempt. */
  retryInMs?: number;
}

/** Warning surfaced when the OS has no real secret store (PRD §20, §63.3). */
export interface StorageHealth {
  encryptionAvailable: boolean;
  /** Electron's safeStorage backend on Linux; 'basic_text' means credentials are barely protected. */
  backend: string | null;
  weak: boolean;
}

/** Points at a light, room or scene — what a favourite or a quick action targets. */
export interface ResourceRef {
  type: 'light' | 'room' | 'scene';
  id: string;
}

/** User preferences (PRD §29). Not secret — stored as plain JSON by the main process. */
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  /**
   * Pinned resources, shown first on the dashboard. Stored here rather than in a
   * store of their own because Settings already crosses IPC and survives
   * restarts, and favourites are neither secret nor large.
   */
  favorites: ResourceRef[];
}
