import { AppError } from '../../shared/errors';
import type {
  Automation,
  ConnectionStatus,
  HubSummary,
  Light,
  ProviderKind,
  RgbColor,
  Room,
  Scene,
} from '../../shared/models';
import type { LightingFacade } from './LightingFacade';
import type { ChangeSet, LightingApi, ProviderAdapter } from './LightingProvider';
import { toHubSummary, type ProviderCredential } from './ProviderCredential';
import { createProviderConnection, type ProviderConnection } from './ProviderConnection';
import type { ProviderRepository } from './ProviderRepository';
import { createResourceIndex } from './ResourceIndex';

/**
 * Every configured hub, live at the same time, behind one lighting surface.
 *
 * Reads concatenate across whatever is currently connected; a hub that is down
 * contributes nothing rather than failing the call, so losing one bridge does
 * not blank the screen for the other. Writes are routed by resource id through
 * the ResourceIndex.
 */

export interface ProviderRegistry extends LightingFacade {
  /** Connects every stored hub. Resolves once they have all settled. */
  start(): Promise<void>;
  /** Stores a hub and connects it. */
  add(credential: ProviderCredential): Promise<void>;
  /** Disconnects and forgets a hub (PRD §29 "Forget Bridge"). */
  remove(id: string): Promise<void>;
  reconnectAll(): Promise<ConnectionStatus[]>;
  statuses(): ConnectionStatus[];
  hubs(): HubSummary[];
  stop(): void;
}

export interface ProviderRegistryOptions {
  repository: ProviderRepository;
  /** Partial so a build can ship without every adapter wired up. */
  adapters: Partial<Record<ProviderKind, ProviderAdapter<ProviderCredential>>>;
  onStatuses(statuses: ConnectionStatus[]): void;
  onChanges(changes: ChangeSet): void;
}

export function createProviderRegistry(options: ProviderRegistryOptions): ProviderRegistry {
  const { repository, adapters, onStatuses, onChanges } = options;

  const connections = new Map<string, ProviderConnection>();
  const index = createResourceIndex();

  const statuses = (): ConnectionStatus[] =>
    [...connections.values()].map((connection) => connection.status());

  const live = (): { providerId: string; api: LightingApi }[] =>
    [...connections.entries()].flatMap(([providerId, connection]) => {
      const api = connection.api();
      return api ? [{ providerId, api }] : [];
    });

  /**
   * Rebuilt whenever the set of resources can have changed. Scenes and
   * automations are in here too: they are addressed by bare id just like lights.
   */
  const reindex = (): void => {
    index.rebuild(
      live().map(({ providerId, api }) => ({
        providerId,
        ids: [
          ...api.getLights().map((light) => light.id),
          ...api.getRooms().map((room) => room.id),
          ...api.getScenes().map((scene) => scene.id),
          ...api.getAutomations().map((automation) => automation.id),
        ],
      })),
    );
  };

  /**
   * A miss is worth one rebuild before giving up: a light can appear between
   * refreshes, and the alternative is telling the user a bulb they can see does
   * not exist.
   */
  const apiFor = (id: string): LightingApi => {
    let providerId = index.owner(id);
    if (!providerId) {
      reindex();
      providerId = index.owner(id);
    }

    const api = providerId ? connections.get(providerId)?.api() : null;
    if (!api) throw new AppError('ResourceUnavailable', `no connected hub owns ${id}`);
    return api;
  };

  const collect = <T>(read: (api: LightingApi) => T[]): T[] =>
    live().flatMap(({ api }) => read(api));

  const attach = (credential: ProviderCredential): ProviderConnection => {
    const adapter = adapters[credential.kind];
    if (!adapter) throw new AppError('RequestFailed', `no adapter for ${credential.kind}`);

    const connection = createProviderConnection({
      credential,
      adapter,
      onStatus: () => onStatuses(statuses()),
      onChanges: (changes) => {
        reindex();
        onChanges(changes);
      },
    });

    connections.set(credential.id, connection);
    return connection;
  };

  return {
    async start() {
      // Settled, not all: one unreachable hub must not hold up the others.
      await Promise.allSettled(
        repository.list().map((credential) => attach(credential).connect()),
      );
      reindex();
      onStatuses(statuses());
    },

    async add(credential) {
      connections.get(credential.id)?.stop();
      repository.save(credential);
      await attach(credential).connect();
      reindex();
    },

    async remove(id) {
      connections.get(id)?.stop();
      connections.delete(id);
      repository.remove(id);
      reindex();
      onStatuses(statuses());
    },

    async reconnectAll() {
      await Promise.allSettled([...connections.values()].map((c) => c.reconnect()));
      reindex();
      return statuses();
    },

    statuses,
    hubs: () => repository.list().map(toHubSummary),

    stop() {
      for (const connection of connections.values()) connection.stop();
      connections.clear();
    },

    // --- Reads: merged across every connected hub -------------------------

    getLights: () => collect<Light>((api) => api.getLights()),
    getRooms: () => collect<Room>((api) => api.getRooms()),
    getScenes: () => collect<Scene>((api) => api.getScenes()),
    getAutomations: () => collect<Automation>((api) => api.getAutomations()),

    getLight: (id) => apiFor(id).getLight(id),
    getRoom: (id) => apiFor(id).getRoom(id),

    // --- Writes: routed to the hub that owns the id -----------------------
    //
    // Async so an unroutable id comes back as a rejected promise. Declaring
    // Promise<void> and then throwing synchronously would slip straight past
    // any caller that only attached a .catch().

    setLightPower: async (id, on) => apiFor(id).setLightPower(id, on),
    setLightBrightness: async (id, brightness) => apiFor(id).setLightBrightness(id, brightness),
    setLightColor: async (id, color: RgbColor) => apiFor(id).setLightColor(id, color),
    setLightTemperature: async (id, temperature) =>
      apiFor(id).setLightTemperature(id, temperature),
    setRoomPower: async (id, on) => apiFor(id).setRoomPower(id, on),
    setRoomBrightness: async (id, brightness) => apiFor(id).setRoomBrightness(id, brightness),
    activateScene: async (id) => apiFor(id).activateScene(id),
    setAutomationEnabled: async (id, enabled) => apiFor(id).setAutomationEnabled(id, enabled),
  };
}
