import type { ProviderAdapter, ProviderSession } from '../providers/LightingProvider';
import type { HomeAssistantCredential } from '../providers/ProviderCredential';
import { createHaApi } from './HaApi';
import { createHaClient } from './HaClient';
import { createHaTransport } from './HaTransport';
import { openHaSocket } from './HaWebSocket';

/**
 * Everything Home Assistant-specific about opening a connection: the bearer
 * transport, the REST client, and the WebSocket that carries both the area
 * registry and the live state.
 *
 * This is the whole point of the provider abstraction: a Spectrum Smart bulb
 * needs no code of its own here. Home Assistant already speaks to it — through
 * Tuya, LocalTuya or whatever else — and exposes it as a `light.*` entity, so
 * it arrives through this adapter like any other brand.
 *
 * There is no `recover`: unlike a bridge found by mDNS, a Home Assistant
 * instance is reached at an address the user typed, and guessing a new one for
 * them would be wrong.
 */

export function createHaAdapter(): ProviderAdapter<HomeAssistantCredential> {
  return {
    kind: 'homeassistant',

    async connect(credential, hooks): Promise<ProviderSession> {
      const transport = createHaTransport(credential.address, credential.token);
      const client = createHaClient(transport);

      // Fails fast and with the right error: a bad token comes back as
      // Unauthorized here rather than as a socket that closes for no stated
      // reason, and the connection layer stops retrying on that code.
      await client.ping();

      let api: ReturnType<typeof createHaApi> | null = null;

      const socket = await openHaSocket({
        transport,
        onStateChanged: (_entityId, state) => {
          // A null state means the entity was removed; the next refresh will
          // drop it, and there is nothing to fold in meanwhile.
          if (!api || !state) return;
          const changes = api.applyUpdates([state]);
          if (changes.lights.length > 0 || changes.rooms.length > 0) hooks.onChanges(changes);
        },
        onClosed: hooks.onClosed,
      });

      try {
        // Areas live only on the socket, and they are what turns a flat list of
        // entities into rooms — so the registry has to come before the states.
        const { areas, areaByEntity } = await socket.registry();

        api = createHaApi({ client, providerId: credential.id, areas, areaByEntity });
        await api.refresh();

        // Subscribing last means no event can arrive before there is a cache to
        // fold it into.
        await socket.subscribe();

        return { api, stop: () => socket.close() };
      } catch (error) {
        socket.close();
        throw error;
      }
    },
  };
}
