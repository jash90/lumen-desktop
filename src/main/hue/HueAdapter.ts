import type { BridgeDiscoveryService } from '../bridge/BridgeDiscoveryService';
import type { BridgeCredential, BridgeRepository } from '../bridge/BridgeRepository';
import type { ProviderAdapter, ProviderSession } from '../providers/LightingProvider';
import { createHueApi } from './HueApi';
import { createHueClient } from './HueClient';
import { startEventStream } from './HueEventStream';
import { createHueTransport } from './HueTransport';

/**
 * Everything Philips-specific about opening a connection: the pinned-CA
 * transport, the CLIP v2 client, and the SSE event stream.
 *
 * This used to be four lines inline in ConnectionManager, which is why the
 * manager could only ever manage a Hue bridge. The retry policy stays out
 * there — one place deciding when to reconnect, whatever it is reconnecting to.
 */

export interface HueAdapterOptions {
  repository: BridgeRepository;
  discovery: BridgeDiscoveryService;
}

export function createHueAdapter(
  options: HueAdapterOptions,
): ProviderAdapter<BridgeCredential> {
  const { repository, discovery } = options;

  return {
    kind: 'hue',

    async connect(credential, hooks): Promise<ProviderSession> {
      const transport = createHueTransport(credential.bridgeIp, credential.bridgeId);

      try {
        const api = createHueApi(createHueClient(transport, credential.applicationKey));
        await api.refresh();

        const stream = await startEventStream({
          transport,
          applicationKey: credential.applicationKey,
          onUpdates: (updates) => {
            const changes = api.applyUpdates(updates);
            if (changes.lights.length > 0 || changes.rooms.length > 0) hooks.onChanges(changes);
          },
          onClosed: hooks.onClosed,
        });

        return {
          api,
          stop() {
            stream.stop();
            transport.destroy();
          },
        };
      } catch (error) {
        // The socket is ours until a session exists to own it.
        transport.destroy();
        throw error;
      }
    },

    /** Finds the same bridge id at a different address after a DHCP renewal (PRD §51). */
    async recover(credential) {
      const ip = await discovery.findKnownBridge(credential.bridgeId);
      if (!ip || ip === credential.bridgeIp) return null;
      repository.updateIp(credential.bridgeId, ip);
      return { ...credential, bridgeIp: ip };
    },
  };
}
