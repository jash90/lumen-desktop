import os from 'node:os';

import { HueError, toSerializedError } from '../../shared/errors';
import type { PairingState } from '../../shared/ipc';
import type { BridgeSummary } from '../../shared/models';
import { pairingResponseSchema } from '../hue/dto';
import { createHueTransport } from '../hue/HueTransport';
import { probeBridge } from './BridgeDiscoveryService';
import type { BridgeRepository } from './BridgeRepository';

/**
 * The link-button ceremony (PRD §22, §40).
 *
 * Hue requires physical proof of presence: the bridge refuses to mint an
 * application key until someone presses its button, so the only correct
 * implementation is to keep asking for up to a minute while the UI tells the
 * user what to do.
 */

const PAIRING_TIMEOUT_MS = 60_000;
const RETRY_INTERVAL_MS = 1_000;
/** Hue rejects a devicetype longer than 40 characters. */
const MAX_DEVICE_TYPE_LENGTH = 40;
/** "link button not pressed" */
const ERROR_LINK_BUTTON_NOT_PRESSED = 101;

function deviceType(): string {
  const host = os.hostname().replace(/[^\w.-]/g, '').slice(0, 20) || 'desktop';
  return `hue-desktop#${host}`.slice(0, MAX_DEVICE_TYPE_LENGTH);
}

export interface BridgePairingService {
  pair(ip: string): Promise<BridgeSummary>;
  cancel(): void;
}

export function createBridgePairingService(
  repository: BridgeRepository,
  onState: (state: PairingState) => void,
): BridgePairingService {
  let cancelled = false;

  return {
    cancel() {
      cancelled = true;
    },

    async pair(ip) {
      cancelled = false;
      onState({ status: 'pairing', ip });

      // Establishes both that this is a real Hue Bridge and what its id is, so
      // the key we are about to receive can be pinned to that identity.
      const { bridgeId, config } = await probeBridge(ip);

      const transport = createHueTransport(ip, bridgeId);
      const payload = JSON.stringify({ devicetype: deviceType() });
      const deadline = Date.now() + PAIRING_TIMEOUT_MS;

      try {
        while (Date.now() < deadline) {
          if (cancelled) throw new HueError('PairingTimeout', 'cancelled by user');

          const { body } = await transport.request({
            method: 'POST',
            path: '/api',
            headers: {
              'content-type': 'application/json',
              'content-length': String(Buffer.byteLength(payload)),
            },
            body: payload,
          });

          const parsed = pairingResponseSchema.safeParse(JSON.parse(body));
          const entry = parsed.success ? parsed.data[0] : undefined;

          if (entry?.success) {
            const summary: BridgeSummary = {
              id: bridgeId,
              name: config.name,
              ip,
              modelId: config.modelid,
              swVersion: config.swversion,
            };
            repository.save({
              bridgeId,
              bridgeIp: ip,
              name: config.name,
              applicationKey: entry.success.username,
              modelId: config.modelid,
              swVersion: config.swversion,
            });
            onState({ status: 'connected', bridge: summary });
            return summary;
          }

          if (entry?.error && entry.error.type !== ERROR_LINK_BUTTON_NOT_PRESSED) {
            throw new HueError('RequestFailed', entry.error.description);
          }

          onState({
            status: 'waitingForButton',
            ip,
            secondsLeft: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
          });

          await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
        }

        throw new HueError('PairingTimeout');
      } catch (error) {
        const hueError =
          error instanceof HueError ? error : new HueError('RequestFailed', String(error));
        onState({ status: 'failed', error: toSerializedError(hueError) });
        throw hueError;
      } finally {
        transport.destroy();
      }
    },
  };
}
