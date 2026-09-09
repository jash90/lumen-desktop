import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HueCredential } from '../src/main/providers/ProviderCredential';
import { APP_GROUP } from '../src/shared/identity';

/**
 * Exercises the real filesystem side of the App Group export: the widget reads
 * these files directly, so the permissions and the removal-on-unpair behaviour
 * are the contract, not an implementation detail.
 */

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-widget-'));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? home : path.join(home, name)),
  },
}));

const { createWidgetBridge } = await import('../src/main/widget/WidgetBridge');

const credentialsPath = path.join(
  home,
  'Library',
  'Group Containers',
  APP_GROUP,
  'widget-credentials.json',
);

const credential: HueCredential = {
  kind: 'hue',
  id: '001788fffe1234ab',
  address: '192.168.1.42',
  name: 'Hue Bridge',
  applicationKey: 'secret-key',
};

const exported = [
  {
    kind: 'hue' as const,
    providerId: credential.id,
    address: credential.address,
    applicationKey: credential.applicationKey,
  },
];

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe.runIf(process.platform === 'darwin')('publishCredentials', () => {
  beforeEach(() => fs.rmSync(credentialsPath, { force: true }));

  it('writes what the widget needs, readable only by this user', () => {
    createWidgetBridge().publishCredentials(exported);

    expect(JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))).toEqual(exported);
    // These secrets are no longer Keychain-protected once exported.
    expect(fs.statSync(credentialsPath).mode & 0o777).toBe(0o600);
  });

  it('removes the file when every hub is forgotten', () => {
    const widget = createWidgetBridge();
    widget.publishCredentials(exported);
    widget.publishCredentials([]);

    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('does not rewrite the file when nothing changed', () => {
    const widget = createWidgetBridge();
    widget.publishCredentials(exported);
    const first = fs.statSync(credentialsPath).mtimeMs;

    widget.publishCredentials([{ ...exported[0]! }]);
    expect(fs.statSync(credentialsPath).mtimeMs).toBe(first);
  });

  it('re-exports after a failed write instead of caching the failure', () => {
    const widget = createWidgetBridge();
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    widget.publishCredentials(exported);
    expect(fs.existsSync(credentialsPath)).toBe(false);

    write.mockRestore();
    widget.publishCredentials(exported);
    expect(fs.existsSync(credentialsPath)).toBe(true);
  });
});
