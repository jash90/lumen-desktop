import path from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron';
import started from 'electron-squirrel-startup';

import { EVENT_CHANNELS } from '../shared/ipc';
import { createBridgeDiscoveryService } from './bridge/BridgeDiscoveryService';
import { createBridgePairingService } from './bridge/BridgePairingService';
import { createBridgeRepository } from './bridge/BridgeRepository';
import { createConnectionManager } from './bridge/ConnectionManager';
import { broadcast } from './ipc/handlers';
import { registerIpcHandlers } from './ipc/register';
import { createSecureStorage } from './storage/SecureStorage';
import { createSettingsStorage } from './storage/SettingsStorage';
import { createWidgetBridge } from './widget/WidgetBridge';

if (started) app.quit();

const isDevelopment = !app.isPackaged;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 520,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0f13' : '#f6f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // PRD §33 — the renderer gets no Node access whatsoever.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Nothing in this app should ever navigate away or spawn a window; if the UI
  // needs to open a link, it goes to the system browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  window.once('ready-to-show', () => window.show());

  // Without this an unreachable dev server or a broken bundle leaves a process
  // running with no window and no explanation — the user just sees nothing.
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[window] failed to load ${url}: ${description} (${code})`);
    window.show();
  });

  const target = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));

  target.catch((error: unknown) => {
    console.error('[window] load rejected:', error);
    window.show();
  });

  return window;
}

/**
 * Content Security Policy is applied to the packaged app only: the Vite dev
 * server needs inline scripts and a websocket for HMR, and weakening the
 * production policy to accommodate that would defeat the point.
 */
function applyContentSecurityPolicy(): void {
  if (isDevelopment) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    });
  });
}

void app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    // A failure here used to leave Electron alive with no window at all.
    console.error('[startup] failed:', error);
    dialog.showErrorBox(
      'Hue Desktop nie mógł się uruchomić',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

async function bootstrap(): Promise<void> {
  applyContentSecurityPolicy();

  // safeStorage is only usable once the app is ready, so the whole object graph
  // is built here rather than at module scope.
  const storage = createSecureStorage();
  const settings = createSettingsStorage();
  const repository = createBridgeRepository(storage);
  const discovery = createBridgeDiscoveryService(repository);
  const pairing = createBridgePairingService(repository, (state) =>
    broadcast(EVENT_CHANNELS.pairingState, state),
  );
  const widget = createWidgetBridge();

  /**
   * The macOS widget mirrors whatever the app currently knows. Recomputing the
   * whole snapshot is cheap — it reads the in-memory cache, not the bridge — and
   * avoids having to merge partial event updates a second time.
   */
  const publishWidgetState = (): void => {
    try {
      const status = connection.status();
      if (status.state !== 'connected') {
        widget.publish(false, [], []);
        return;
      }
      const api = connection.requireApi();
      widget.publish(true, api.getRooms(), api.getLights());
    } catch (error) {
      console.warn('[widget] snapshot skipped:', error);
    }
  };

  const connection = createConnectionManager({
    repository,
    discovery,
    onStatus: (status) => {
      broadcast(EVENT_CHANNELS.connectionChanged, status);
      publishWidgetState();
    },
    onChanges: (changes) => {
      if (changes.lights.length > 0) broadcast(EVENT_CHANNELS.lightChanged, changes.lights);
      if (changes.rooms.length > 0) broadcast(EVENT_CHANNELS.roomChanged, changes.rooms);
      publishWidgetState();
    },
  });

  const theme = settings.get().theme;
  nativeTheme.themeSource = theme;

  registerIpcHandlers({ connection, discovery, pairing, repository, storage, settings });

  createWindow();

  // Reconnecting to a known bridge happens in the background; the window opens
  // immediately and shows "Łączenie…" rather than waiting on the network.
  connection.start().catch((error: unknown) => {
    console.error('[startup] initial connection failed:', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('window-all-closed', () => {
  // Tray support is P1; until then closing the last window really does quit.
  if (process.platform !== 'darwin') app.quit();
});
