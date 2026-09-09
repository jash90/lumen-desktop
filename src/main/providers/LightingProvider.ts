import type { Automation, Light, RgbColor, Room, Scene } from '../../shared/models';

/**
 * What every brand of lighting has to look like from the app's side.
 *
 * The shape is not new — it is the interface the Hue implementation already had,
 * which never mentioned a bridge, a mirek or a CIE coordinate. Naming it after
 * the vendor was the only thing tying it to one.
 *
 * Reads are synchronous because an implementation is expected to hold the last
 * known state: the light-to-room join, translating partial push updates into
 * whole domain objects, and knowing a bulb's own capability limits all need it,
 * and each would otherwise cost a round trip per call.
 */

export type ProviderKind = 'hue' | 'homeassistant';

export interface ChangeSet {
  lights: Light[];
  rooms: Room[];
}

export interface LightingApi {
  refresh(): Promise<void>;
  getLights(): Light[];
  getLight(id: string): Light;
  getRooms(): Room[];
  getRoom(id: string): Room;
  getScenes(): Scene[];
  getAutomations(): Automation[];
  /** Enables or disables an automation the user created on the hub itself. */
  setAutomationEnabled(id: string, enabled: boolean): Promise<void>;
  /** Applies a stored scene; the resulting light changes arrive as a push update. */
  activateScene(id: string): Promise<void>;
  setLightPower(id: string, on: boolean): Promise<void>;
  setLightBrightness(id: string, brightness: number): Promise<void>;
  setLightColor(id: string, color: RgbColor): Promise<void>;
  setLightTemperature(id: string, temperature: number): Promise<void>;
  setRoomPower(id: string, on: boolean): Promise<void>;
  setRoomBrightness(id: string, brightness: number): Promise<void>;
  /**
   * Applies partial resource updates pushed by the hub and returns what changed.
   * The payload shape is the provider's own business, so it arrives untyped.
   */
  applyUpdates(updates: readonly unknown[]): ChangeSet;
}

export interface ProviderHooks {
  onChanges(changes: ChangeSet): void;
  /** The push channel ended. Reconnecting is the caller's decision, not ours. */
  onClosed(error?: Error): void;
}

/** A connection that is up: the API to talk to, and the way to take it down. */
export interface ProviderSession {
  readonly api: LightingApi;
  stop(): void;
}

/**
 * Everything brand-specific — transport, authentication, push channel — lives
 * behind this. `connect` must not resolve until the connection is fully usable,
 * push channel included: the caller resets its backoff on the strength of that
 * promise, and a hub whose REST API answers while its event stream keeps dying
 * would otherwise retry forever without ever backing off.
 */
export interface ProviderAdapter<C> {
  readonly kind: ProviderKind;
  connect(credential: C, hooks: ProviderHooks): Promise<ProviderSession>;
  /**
   * Optional second chance after a failed connect — a hub that moved to another
   * address on a new DHCP lease. Returns the corrected credential, or null when
   * the failure was something else.
   */
  recover?(credential: C): Promise<C | null>;
}
