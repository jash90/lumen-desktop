import { afterEach, describe, expect, it, vi } from 'vitest';

import { createResourceIndex } from '../src/main/providers/ResourceIndex';

/**
 * With several hubs live at once, a command carries nothing but an id — so
 * getting this wrong means switching off a light in the wrong house.
 */
describe('createResourceIndex', () => {
  afterEach(() => vi.restoreAllMocks());

  it('points each id at the hub that reported it', () => {
    const index = createResourceIndex();
    index.rebuild([
      { providerId: 'bridge-1', ids: ['3a5b-uuid', 'room-living'] },
      { providerId: 'ha-1', ids: ['light.kitchen'] },
    ]);

    expect(index.owner('3a5b-uuid')).toBe('bridge-1');
    expect(index.owner('light.kitchen')).toBe('ha-1');
  });

  it('reports nothing for an id no hub claims', () => {
    const index = createResourceIndex();
    index.rebuild([{ providerId: 'bridge-1', ids: ['known'] }]);

    expect(index.owner('never-heard-of-it')).toBeNull();
  });

  it('forgets resources of a hub that is gone', () => {
    const index = createResourceIndex();
    index.rebuild([
      { providerId: 'bridge-1', ids: ['a'] },
      { providerId: 'ha-1', ids: ['b'] },
    ]);
    index.rebuild([{ providerId: 'bridge-1', ids: ['a'] }]);

    expect(index.owner('b')).toBeNull();
  });

  it('warns rather than silently picking a side when two hubs claim one id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const index = createResourceIndex();

    index.rebuild([
      { providerId: 'bridge-1', ids: ['shared'] },
      { providerId: 'ha-1', ids: ['shared'] },
    ]);

    expect(warn).toHaveBeenCalledOnce();
    expect(index.owner('shared')).toBe('ha-1');
  });
});
