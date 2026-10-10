import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import type { UpdateStatus } from '../src/shared/ipc';
import {
  feedUrlFor,
  isNewer,
  RELEASES_PAGE,
  updateStrategyFor,
  type UpdateStrategy,
} from '../src/main/updater/feed';
import {
  createUpdateService,
  updateCheckFailedMessage,
  type SquirrelUpdater,
} from '../src/main/updater/UpdateService';

describe('feedUrlFor', () => {
  it('asks update.electronjs.org about this exact build', () => {
    expect(feedUrlFor('darwin', 'arm64', '0.4.1')).toBe(
      'https://update.electronjs.org/jash90/lumen-desktop/darwin-arm64/0.4.1',
    );
  });
});

describe('updateStrategyFor', () => {
  it('lets Squirrel install on macOS and Windows', () => {
    expect(updateStrategyFor('darwin', true)).toBe('squirrel');
    expect(updateStrategyFor('win32', true)).toBe('squirrel');
  });

  it('can only point at the release on Linux', () => {
    expect(updateStrategyFor('linux', true)).toBe('manual');
  });

  it('does nothing in a development run, which has no bundle to replace', () => {
    expect(updateStrategyFor('darwin', false)).toBe('unsupported');
  });
});

describe('isNewer', () => {
  it.each([
    ['v0.4.2', '0.4.1', true],
    ['0.5.0', '0.4.9', true],
    ['1.0.0', '0.99.99', true],
    ['0.4.10', '0.4.9', true],
    ['v0.4.1', '0.4.1', false],
    ['0.4.0', '0.4.1', false],
    ['not-a-version', '0.4.1', false],
  ])('%s over %s → %s', (candidate, current, expected) => {
    expect(isNewer(candidate, current)).toBe(expected);
  });
});

class FakeUpdater extends EventEmitter implements SquirrelUpdater {
  setFeedURL = vi.fn();
  checkForUpdates = vi.fn();
  quitAndInstall = vi.fn();
}

function setup(strategy: UpdateStrategy, latestTag: () => Promise<string> = async () => 'v0.4.1') {
  const updater = new FakeUpdater();
  const statuses: UpdateStatus[] = [];
  const openExternal = vi.fn();
  const service = createUpdateService({
    strategy,
    currentVersion: '0.4.1',
    feedUrl: 'https://feed.example/darwin-arm64/0.4.1',
    updater,
    fetchLatestTag: latestTag,
    openExternal,
    onStatus: (status) => statuses.push(status),
  });
  return { service, updater, statuses, openExternal };
}

describe('UpdateService with Squirrel', () => {
  it('sets the feed once and walks through download to ready', async () => {
    const { service, updater } = setup('squirrel');

    await service.check();
    expect(service.status()).toEqual({ state: 'checking' });
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      url: 'https://feed.example/darwin-arm64/0.4.1',
    });

    updater.emit('update-available');
    expect(service.status()).toEqual({ state: 'downloading' });

    updater.emit('update-downloaded', {}, 'notes', 'v0.4.2');
    expect(service.status()).toEqual({ state: 'ready', version: '0.4.2' });

    await service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('reports being up to date', async () => {
    const { service, updater } = setup('squirrel');
    await service.check();
    updater.emit('update-not-available');
    expect(service.status()).toEqual({ state: 'upToDate' });

    // A second check reuses the feed rather than setting it again.
    await service.check();
    expect(updater.setFeedURL).toHaveBeenCalledOnce();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('ignores a click while a check is already running', async () => {
    const { service, updater } = setup('squirrel');
    await service.check();
    await service.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('turns an updater error into a message a user can act on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, updater } = setup('squirrel');
    await service.check();
    updater.emit('error', new Error('Could not get code signature for running application'));
    expect(service.status()).toEqual({ state: 'error', message: updateCheckFailedMessage() });
  });

  it('survives an unsigned build throwing from setFeedURL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, updater } = setup('squirrel');
    updater.setFeedURL.mockImplementation(() => {
      throw new Error('Could not get code signature');
    });
    expect(await service.check()).toEqual({ state: 'error', message: updateCheckFailedMessage() });
  });

  it('pushes every change to the listener', async () => {
    const { service, updater, statuses } = setup('squirrel');
    await service.check();
    updater.emit('update-not-available');
    expect(statuses).toEqual([{ state: 'checking' }, { state: 'upToDate' }]);
  });

  it('does not restart when nothing has been downloaded', async () => {
    const { service, updater } = setup('squirrel');
    await service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe('UpdateService on Linux', () => {
  it('points at the release page when a newer version is out', async () => {
    const { service, openExternal, updater } = setup('manual', async () => 'v0.5.0');

    expect(await service.check()).toEqual({
      state: 'available',
      version: '0.5.0',
      url: RELEASES_PAGE,
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();

    await service.install();
    expect(openExternal).toHaveBeenCalledWith(RELEASES_PAGE);
  });

  it('reports being up to date when the newest release is this one', async () => {
    const { service } = setup('manual');
    expect(await service.check()).toEqual({ state: 'upToDate' });
  });

  it('reports a failed request instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service } = setup('manual', () => Promise.reject(new Error('ENOTFOUND')));
    expect(await service.check()).toEqual({ state: 'error', message: updateCheckFailedMessage() });
  });
});

describe('UpdateService in development', () => {
  it('never touches the updater', async () => {
    const { service, updater } = setup('unsupported');
    expect(await service.check()).toEqual({ state: 'unsupported' });
    expect(updater.setFeedURL).not.toHaveBeenCalled();
  });
});
