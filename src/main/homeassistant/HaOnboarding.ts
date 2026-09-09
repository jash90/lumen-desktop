import { AppError } from '../../shared/errors';
import type { HomeAssistantCredential } from '../providers/ProviderCredential';
import { createHaClient } from './HaClient';
import { createHaTransport, normaliseBaseUrl } from './HaTransport';

/**
 * Turns what the user typed into a credential worth storing.
 *
 * Home Assistant has no link-button ceremony, so this is the whole of its
 * onboarding: check the URL parses, check the token actually works, and derive
 * a stable id. Verifying before saving matters — otherwise a typo is stored as
 * a hub that sits permanently offline with nothing saying why.
 */

export interface HomeAssistantInput {
  baseUrl: string;
  token: string;
  name?: string;
}

/**
 * Derived from the address rather than random, so re-adding the same instance
 * replaces it instead of listing it twice. The token is deliberately not part
 * of it: rotating a token should update a hub, not create a second one.
 */
export function homeAssistantIdFor(baseUrl: string): string {
  return `ha:${new URL(baseUrl).host}`;
}

export async function verifyHomeAssistant(
  input: HomeAssistantInput,
): Promise<HomeAssistantCredential> {
  const address = normaliseBaseUrl(input.baseUrl);
  const token = input.token.trim();
  if (token.length === 0) throw new AppError('Unauthorized', 'no access token given');

  const client = createHaClient(createHaTransport(address, token));
  await client.ping();

  return {
    kind: 'homeassistant',
    id: homeAssistantIdFor(address),
    name: input.name?.trim() || 'Home Assistant',
    address,
    token,
  };
}
