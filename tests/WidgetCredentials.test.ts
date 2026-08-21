import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BridgeCredential } from '../src/main/bridge/BridgeRepository';

/**
 * Exercises the real filesystem side of the App Group export: the widget reads
 * these files directly, so the permissions and the removal-on-unpair behaviour
 * are the contract, not an implementation detail.
 */

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hue-widget-'));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? home : path.join(home, name)),
  },
}));

const { createWidgetBridge } = await import('../src/main/widget/WidgetBridge');

const APP_GROUP = 'H2X8YGN869.com.bartlomiejzimny.huedesktop';
const credentialsPath = path.join(
  home,
  'Library',
  'Group Containers',
  APP_GROUP,
  'widget-credentials.json',
);

const credential: BridgeCredential = {
  bridgeId: '001788fffe1234ab',
  bridgeIp: '192.168.1.42',
  name: 'Hue Bridge',
  applicationKey: 'secret-key',
};

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe.runIf(process.platform === 'darwin')('publishCredentials', () => {
  beforeEach(() => fs.rmSync(credentialsPath, { force: true }));

  it('writes what the widget needs, readable only by this user', () => {
    createWidgetBridge().publishCredentials(credential);

    expect(JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))).toEqual({
      bridgeId: '001788fffe1234ab',
      ip: '192.168.1.42',
      applicationKey: 'secret-key',
    });
    // The Hue key is no longer Keychain-protected once exported.
    expect(fs.statSync(credentialsPath).mode & 0o777).toBe(0o600);
  });

  it('removes the key when the bridge is forgotten', () => {
    const widget = createWidgetBridge();
    widget.publishCredentials(credential);
    widget.publishCredentials(null);

    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('does not rewrite the file when nothing changed', () => {
    const widget = createWidgetBridge();
    widget.publishCredentials(credential);
    const first = fs.statSync(credentialsPath).mtimeMs;

    widget.publishCredentials({ ...credential });
    expect(fs.statSync(credentialsPath).mtimeMs).toBe(first);
  });

  it('re-exports after a failed write instead of caching the failure', () => {
    const widget = createWidgetBridge();
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    widget.publishCredentials(credential);
    expect(fs.existsSync(credentialsPath)).toBe(false);

    write.mockRestore();
    widget.publishCredentials(credential);
    expect(fs.existsSync(credentialsPath)).toBe(true);
  });
});
