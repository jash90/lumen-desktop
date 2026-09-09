import type { LightingApi } from './LightingProvider';

/**
 * The lighting surface without the lifecycle a single connection owns.
 *
 * What the tray, the action runner and the IPC handlers actually need: they read
 * and write lights, and have no business refreshing a cache or decoding a push
 * frame. Having it separate also keeps them from importing the registry, which
 * would drag the whole connection machinery in behind it.
 */
export type LightingFacade = Omit<LightingApi, 'refresh' | 'applyUpdates'>;
