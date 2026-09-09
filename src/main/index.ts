import path from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron';
import started from 'electron-squirrel-startup';

import type { Action } from '../shared/models';
import { EVENT_CHANNELS } from '../shared/ipc';
import { PRODUCT_NAME } from '../shared/identity';
import { createActionRunner } from './actions/ActionRunner';
import { startedHidden } from './autostart';
import { createBridgeDiscoveryService } from './bridge/BridgeDiscoveryService';
import { createBridgePairingService } from './bridge/BridgePairingService';
import { createHaAdapter } from './homeassistant/HaAdapter';
import { createHueAdapter } from './hue/HueAdapter';
import { createProviderRegistry } from './providers/ProviderRegistry';
import { createProviderRepository } from './providers/ProviderRepository';
import { broadcast } from './ipc/handlers';
import { runUserDataMigration } from './migrateUserData';
import { registerIpcHandlers } from './ipc/register';
import { createSecureStorage } from './storage/SecureStorage';
import { createSettingsStorage } from './storage/SettingsStorage';
import { createShortcutRegistrar } from './shortcuts/GlobalShortcuts';
import { createTray, type TrayController } from './tray/Tray';
import { createWidgetBridge, toCredentials } from './widget/WidgetBridge';

if (started) app.quit();

const isDevelopment = !app.isPackaged;

/**
 * Closing the window hides it while the tray is around, so "Quit" from the
 * tray needs a way to say it really means it.
 */
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});

let tray: TrayController | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 520,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0f15' : '#f3f5f9',
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

  // Launched by the OS at login: stay in the tray instead of opening a window
  // in the user's face.
  window.once('ready-to-show', () => {
    if (!startedHidden()) window.show();
  });

  // With a tray present the window closes to it instead of ending the app —
  // otherwise the tray icon would linger with nothing behind it.
  window.on('close', (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    window.hide();
  });

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
      `${PRODUCT_NAME} could not start`,
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

async function bootstrap(): Promise<void> {
  applyContentSecurityPolicy();

  // Has to happen before the first read: renaming the app moved the data
  // directory, and this carries the previous installation's files across.
  runUserDataMigration();

  // safeStorage is only usable once the app is ready, so the whole object graph
  // is built here rather than at module scope.
  const storage = createSecureStorage();
  const settings = createSettingsStorage();
  const repository = createProviderRepository(storage);
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
      // The widget speaks to the hubs itself, so it needs the credentials even
      // while the app cannot reach them — this goes before the connected check.
      const exported = toCredentials(
        repository.list(),
        settings.get().exportHomeAssistantToWidget,
      );
      widget.publishCredentials(exported);

      // A room whose hub was not exported still shows, but as a reading rather
      // than a switch — a dead button would be worse than an honest label.
      const controllable = new Set(exported.map((entry) => entry.providerId));

      const connected = providers.statuses().some((status) => status.state === 'connected');
      if (!connected) {
        widget.publish(false, [], [], controllable);
        return;
      }
      widget.publish(true, providers.getRooms(), providers.getLights(), controllable);
    } catch (error) {
      console.warn('[widget] snapshot skipped:', error);
    }
  };

  const providers = createProviderRegistry({
    repository,
    adapters: {
      hue: createHueAdapter({ repository, discovery }),
      homeassistant: createHaAdapter(),
    },
    onStatuses: (statuses) => {
      broadcast(EVENT_CHANNELS.connectionChanged, statuses);
      publishWidgetState();
      tray?.rebuild();
    },
    onChanges: (changes) => {
      if (changes.lights.length > 0) broadcast(EVENT_CHANNELS.lightChanged, changes.lights);
      if (changes.rooms.length > 0) broadcast(EVENT_CHANNELS.roomChanged, changes.rooms);
      publishWidgetState();
      tray?.rebuild();
    },
  });

  const actions = createActionRunner(providers);
  const runAction = (action: Action): void => {
    actions.run(action).catch((error: unknown) => {
      console.error('[action] failed:', error);
    });
  };
  const shortcuts = createShortcutRegistrar(runAction);
  app.on('will-quit', () => {
    shortcuts.dispose();
    // Hue and Home Assistant get away with leaving their handles to the process
    // teardown; a provider holding a raw socket and a heartbeat interval would
    // keep the event loop alive and the app would simply not exit.
    providers.stop();
  });

  const showWindow = (): void => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      existing.show();
      existing.focus();
      return;
    }
    createWindow();
  };

  tray = createTray({
    snapshot: () => {
      const connected = providers.statuses().some((status) => status.state === 'connected');
      if (!connected) return { connected, rooms: [], scenes: [], favorites: [] };
      return {
        connected,
        rooms: providers.getRooms(),
        scenes: providers.getScenes(),
        favorites: settings.get().favorites,
      };
    },
    run: runAction,
    show: showWindow,
    quit: () => app.quit(),
  });

  const theme = settings.get().theme;
  nativeTheme.themeSource = theme;

  registerIpcHandlers({
    actions,
    shortcuts,
    providers,
    repository,
    discovery,
    pairing,
    storage,
    settings,
  });

  createWindow();

  // Connecting to the known hubs happens in the background; the window opens
  // immediately and shows "Connecting…" rather than waiting on the network.
  providers.start().catch((error: unknown) => {
    console.error('[startup] initial connection failed:', error);
  });

  app.on('activate', showWindow);
}

app.on('window-all-closed', () => {
  // With a tray the app deliberately outlives its window; without one, closing
  // the last window still quits everywhere except macOS.
  if (process.platform !== 'darwin' && !tray) app.quit();
});
