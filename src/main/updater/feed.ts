/**
 * Where updates come from and which mechanism can install them.
 *
 * Kept free of any electron runtime import so it can be unit tested without an
 * Electron process — the same split as tray/menu.ts.
 */

export const UPDATE_REPOSITORY = 'jash90/lumen-desktop';

export const RELEASES_PAGE = `https://github.com/${UPDATE_REPOSITORY}/releases/latest`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;

/**
 * update.electronjs.org reads the repository's published GitHub Releases and
 * answers in the format Squirrel expects: 200 with the ZIP URL on macOS, the
 * RELEASES file on Windows, 204 when the given version is already the newest.
 */
export function feedUrlFor(platform: string, arch: string, version: string): string {
  return `https://update.electronjs.org/${UPDATE_REPOSITORY}/${platform}-${arch}/${version}`;
}

/**
 * - `squirrel`: Electron's autoUpdater downloads and installs in place.
 * - `manual`: .deb and .rpm cannot replace themselves, so the most the app can
 *   do is notice a newer release and send the user to it.
 * - `unsupported`: a development run has no installed bundle to replace.
 */
export type UpdateStrategy = 'squirrel' | 'manual' | 'unsupported';

export function updateStrategyFor(platform: string, isPackaged: boolean): UpdateStrategy {
  if (!isPackaged) return 'unsupported';
  if (platform === 'darwin' || platform === 'win32') return 'squirrel';
  return 'manual';
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True when `candidate` is a strictly newer x.y.z than `current`. Pre-release tags are ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  for (const [index, part] of next.entries()) {
    const other = now[index] ?? 0;
    if (part !== other) return part > other;
  }
  return false;
}
