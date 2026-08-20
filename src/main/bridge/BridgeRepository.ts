import type { SecureStorage } from '../storage/SecureStorage';

/**
 * Persisted bridge credentials (PRD §20, §30).
 *
 * Stored as a list from day one so multi-bridge support later is a UI change,
 * not a migration. The whole record is encrypted by SecureStorage, so the
 * application key is never at rest in plaintext.
 */
export interface BridgeCredential {
  bridgeId: string;
  bridgeIp: string;
  name: string;
  applicationKey: string;
  modelId?: string;
  swVersion?: string;
}

interface StoredCredentials {
  version: 1;
  bridges: BridgeCredential[];
}

export interface BridgeRepository {
  list(): BridgeCredential[];
  /** MVP drives a single bridge; this is the one it uses. */
  getActive(): BridgeCredential | null;
  save(credential: BridgeCredential): void;
  /** DHCP moved the bridge — keep the key, update the address (PRD §51). */
  updateIp(bridgeId: string, ip: string): void;
  remove(bridgeId: string): void;
}

export function createBridgeRepository(storage: SecureStorage): BridgeRepository {
  const load = (): StoredCredentials =>
    storage.read<StoredCredentials>() ?? { version: 1, bridges: [] };

  const persist = (bridges: BridgeCredential[]): void => {
    if (bridges.length === 0) storage.clear();
    else storage.write({ version: 1, bridges } satisfies StoredCredentials);
  };

  return {
    list: () => load().bridges,
    getActive: () => load().bridges[0] ?? null,

    save(credential) {
      const bridges = load().bridges.filter((b) => b.bridgeId !== credential.bridgeId);
      persist([credential, ...bridges]);
    },

    updateIp(bridgeId, ip) {
      const bridges = load().bridges.map((b) =>
        b.bridgeId === bridgeId ? { ...b, bridgeIp: ip } : b,
      );
      persist(bridges);
    },

    remove(bridgeId) {
      persist(load().bridges.filter((b) => b.bridgeId !== bridgeId));
    },
  };
}
