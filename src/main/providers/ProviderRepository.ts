import type { SecureStorage } from '../storage/SecureStorage';
import type { ProviderCredential } from './ProviderCredential';

/**
 * Persisted hub credentials (PRD §20, §30).
 *
 * The whole record is encrypted by SecureStorage, so no key or token is ever at
 * rest in plaintext.
 *
 * There is no "active" entry any more. Every stored hub connects, and they run
 * side by side — which is the point of supporting more than one brand: a house
 * with Hue in the hallway and something else in the kitchen is one house.
 */

interface StoredV1 {
  version: 1;
  bridges: {
    bridgeId: string;
    bridgeIp: string;
    name: string;
    applicationKey: string;
    modelId?: string;
    swVersion?: string;
  }[];
}

interface StoredV2 {
  version: 2;
  providers: ProviderCredential[];
}

type Stored = StoredV1 | StoredV2;

const EMPTY: StoredV2 = { version: 2, providers: [] };

/** Everything stored before multi-provider support was a Hue bridge. */
function migrate(stored: Stored): StoredV2 {
  if (stored.version === 2) return stored;
  return {
    version: 2,
    providers: stored.bridges.map((bridge) => ({
      kind: 'hue' as const,
      id: bridge.bridgeId,
      name: bridge.name,
      address: bridge.bridgeIp,
      applicationKey: bridge.applicationKey,
      modelId: bridge.modelId,
      swVersion: bridge.swVersion,
    })),
  };
}

export interface ProviderRepository {
  list(): ProviderCredential[];
  get(id: string): ProviderCredential | null;
  /** Adds a hub, or replaces the stored copy when it is paired again. */
  save(credential: ProviderCredential): void;
  /** DHCP moved the hub — keep the secret, update the address (PRD §51). */
  updateAddress(id: string, address: string): void;
  remove(id: string): void;
}

export function createProviderRepository(storage: SecureStorage): ProviderRepository {
  const load = (): StoredV2 => {
    const stored = storage.read<Stored>();
    return stored ? migrate(stored) : EMPTY;
  };

  const persist = (providers: ProviderCredential[]): void => {
    if (providers.length === 0) storage.clear();
    else storage.write({ version: 2, providers } satisfies StoredV2);
  };

  return {
    list: () => load().providers,
    get: (id) => load().providers.find((provider) => provider.id === id) ?? null,

    save(credential) {
      // Newest first, so the list reads in the order the user added things.
      const rest = load().providers.filter((provider) => provider.id !== credential.id);
      persist([credential, ...rest]);
    },

    updateAddress(id, address) {
      persist(
        load().providers.map((provider) =>
          provider.id === id ? { ...provider, address } : provider,
        ),
      );
    },

    remove(id) {
      persist(load().providers.filter((provider) => provider.id !== id));
    },
  };
}
