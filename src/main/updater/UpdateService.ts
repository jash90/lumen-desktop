import type { UpdateStatus } from '../../shared/ipc';
import { isNewer, RELEASES_PAGE, type UpdateStrategy } from './feed';

/**
 * Checks for and installs app updates, but only when asked — there is no
 * background polling.
 *
 * Electron's autoUpdater is injected as a narrow interface rather than
 * imported, so the event-to-state mapping is testable without an Electron
 * process.
 */

/** The slice of Electron's autoUpdater this service relies on. */
export interface SquirrelUpdater {
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: () => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(
    event: 'update-downloaded',
    listener: (event: unknown, releaseNotes: string, releaseName: string) => void,
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}

export interface UpdateServiceDependencies {
  strategy: UpdateStrategy;
  currentVersion: string;
  feedUrl: string;
  updater: SquirrelUpdater;
  /** Tag name of the newest published release, e.g. "v0.4.2". */
  fetchLatestTag(): Promise<string>;
  openExternal(url: string): Promise<void> | void;
  onStatus(status: UpdateStatus): void;
}

export interface UpdateService {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  install(): Promise<void>;
}

export const UPDATE_CHECK_FAILED = 'Could not check for updates. Try again later.';

const stripV = (version: string): string => version.replace(/^v/, '');

export function createUpdateService(deps: UpdateServiceDependencies): UpdateService {
  let current: UpdateStatus =
    deps.strategy === 'unsupported' ? { state: 'unsupported' } : { state: 'idle' };
  let feedConfigured = false;

  const set = (next: UpdateStatus): UpdateStatus => {
    current = next;
    deps.onStatus(next);
    return next;
  };

  const fail = (error: unknown): UpdateStatus => {
    // The raw message (a signature error, ENOTFOUND) means nothing to a user;
    // it goes to the log and the UI gets something to act on.
    console.error('[updater] check failed:', error);
    return set({ state: 'error', message: UPDATE_CHECK_FAILED });
  };

  if (deps.strategy === 'squirrel') {
    deps.updater.on('checking-for-update', () => set({ state: 'checking' }));
    // Squirrel starts downloading on its own as soon as it finds an update.
    deps.updater.on('update-available', () => set({ state: 'downloading' }));
    deps.updater.on('update-not-available', () => set({ state: 'upToDate' }));
    deps.updater.on('update-downloaded', (_event, _notes, releaseName) =>
      set({ state: 'ready', version: stripV(releaseName || 'new version') }),
    );
    deps.updater.on('error', fail);
  }

  /** A check already under way, or an update waiting for a restart, is left alone. */
  const busy = (): boolean =>
    current.state === 'checking' || current.state === 'downloading' || current.state === 'ready';

  async function checkManually(): Promise<UpdateStatus> {
    set({ state: 'checking' });
    try {
      const tag = await deps.fetchLatestTag();
      return isNewer(tag, deps.currentVersion)
        ? set({ state: 'available', version: stripV(tag), url: RELEASES_PAGE })
        : set({ state: 'upToDate' });
    } catch (error) {
      return fail(error);
    }
  }

  return {
    status: () => current,

    async check() {
      if (deps.strategy === 'unsupported' || busy()) return current;
      if (deps.strategy === 'manual') return checkManually();

      try {
        if (!feedConfigured) {
          deps.updater.setFeedURL({ url: deps.feedUrl });
          feedConfigured = true;
        }
        // Set here rather than waiting for the event, so the button disables
        // at once instead of after a round trip.
        set({ state: 'checking' });
        deps.updater.checkForUpdates();
      } catch (error) {
        // An unsigned macOS build throws synchronously from setFeedURL.
        return fail(error);
      }
      return current;
    },

    async install() {
      if (current.state === 'ready') {
        deps.updater.quitAndInstall();
      } else if (current.state === 'available') {
        await deps.openExternal(current.url);
      }
    },
  };
}
