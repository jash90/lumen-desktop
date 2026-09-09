import type { HubSummary } from '../../shared/models';

/**
 * What the app has to remember to reach a hub again after a restart.
 *
 * Discriminated by `kind` because the secret is not the same shape from one
 * brand to the next — a Hue application key is not a bearer token — while `id`,
 * `name` and `address` are common enough to build a HubSummary from any of them.
 *
 * Everything here is at rest inside the SecureStorage blob, so no secret is ever
 * written in plaintext, and none of it may cross IPC: the renderer gets the
 * HubSummary projection instead.
 */

export interface HueCredential {
  kind: 'hue';
  /** The bridge id, which is also the Common Name its certificate is checked against. */
  id: string;
  name: string;
  address: string;
  applicationKey: string;
  modelId?: string;
  swVersion?: string;
}

/**
 * A Home Assistant instance, reached at a base URL the user typed with a
 * long-lived access token.
 *
 * The token is a far bigger secret than a Hue application key: it grants the
 * whole Home Assistant API — locks, cameras, alarms — not just the lighting on
 * one local network. It stays inside SecureStorage and never crosses IPC.
 */
export interface HomeAssistantCredential {
  kind: 'homeassistant';
  id: string;
  name: string;
  /** Base URL, e.g. http://homeassistant.local:8123 — no trailing slash. */
  address: string;
  token: string;
}

export type ProviderCredential = HueCredential | HomeAssistantCredential;

export function toHubSummary(credential: ProviderCredential): HubSummary {
  return {
    id: credential.id,
    kind: credential.kind,
    name: credential.name,
    address: credential.address,
    modelId: credential.kind === 'hue' ? credential.modelId : undefined,
    swVersion: credential.kind === 'hue' ? credential.swVersion : undefined,
  };
}
