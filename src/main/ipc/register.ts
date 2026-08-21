import { app, nativeTheme } from 'electron';

import { EVENT_CHANNELS } from '../../shared/ipc';
import type { BridgeDiscoveryService } from '../bridge/BridgeDiscoveryService';
import type { BridgePairingService } from '../bridge/BridgePairingService';
import type { BridgeRepository } from '../bridge/BridgeRepository';
import type { ConnectionManager } from '../bridge/ConnectionManager';
import type { ActionRunner } from '../actions/ActionRunner';
import type { ShortcutRegistrar } from '../shortcuts/GlobalShortcuts';
import type { SecureStorage } from '../storage/SecureStorage';
import type { SettingsStorage } from '../storage/SettingsStorage';
import { applyLoginItem } from '../autostart';
import { args, assertAllChannelsRegistered, broadcast, handle } from './handlers';

export interface IpcContext {
  actions: ActionRunner;
  shortcuts: ShortcutRegistrar;
  connection: ConnectionManager;
  discovery: BridgeDiscoveryService;
  pairing: BridgePairingService;
  repository: BridgeRepository;
  storage: SecureStorage;
  settings: SettingsStorage;
}

/**
 * Registers the whole PRD §17 contract. Kept in one file because the handlers are
 * one-liners over the services — splitting them per resource would add files
 * without adding structure.
 */
export function registerIpcHandlers(context: IpcContext): void {
  const { actions, shortcuts, connection, discovery, pairing, repository, storage, settings } =
    context;

  /** Last result of applying the stored shortcuts; see getShortcutConflicts. */
  let shortcutConflicts: string[] = [];

  const applyShortcuts = (): void => {
    shortcutConflicts = shortcuts.apply(settings.get().shortcuts);
  };
  applyShortcuts();

  handle('getVersion', args.none, () => app.getVersion());

  // Bridge
  handle('discoverBridges', args.none, () => discovery.discover());

  handle('pairBridge', args.ip, async ([ip]) => {
    const summary = await pairing.pair(ip);
    const credential = repository.getActive();
    if (credential) await connection.connect(credential);
    return summary;
  });

  handle('cancelPairing', args.none, () => {
    pairing.cancel();
  });

  handle('getBridge', args.none, () => connection.status().bridge);
  handle('disconnectBridge', args.none, () => connection.forget());
  handle('reconnectBridge', args.none, () => connection.reconnectNow());
  handle('getConnectionStatus', args.none, () => connection.status());
  handle('getStorageHealth', args.none, () => storage.health());

  // Preferences
  handle('getSettings', args.none, () => settings.get());
  handle('setSettings', args.settingsPatch, ([patch]) => {
    const next = settings.set(patch);
    // Pointing nativeTheme at the choice is what makes prefers-color-scheme in the
    // renderer follow it — the UI needs no theme class of its own.
    nativeTheme.themeSource = next.theme;
    applyLoginItem(next.launchAtLogin);
    if (patch.shortcuts) applyShortcuts();
    return next;
  });

  // Lights
  handle('getLights', args.none, () => connection.requireApi().getLights());
  handle('getLight', args.id, ([id]) => connection.requireApi().getLight(id));
  handle('setLightPower', args.idAndBoolean, ([id, on]) =>
    connection.requireApi().setLightPower(id, on),
  );
  handle('setLightBrightness', args.idAndPercent, ([id, brightness]) =>
    connection.requireApi().setLightBrightness(id, brightness),
  );
  handle('setLightColor', args.idAndColor, ([id, color]) =>
    connection.requireApi().setLightColor(id, color),
  );
  handle('setLightTemperature', args.idAndPercent, ([id, temperature]) =>
    connection.requireApi().setLightTemperature(id, temperature),
  );

  // Rooms
  handle('getRooms', args.none, () => connection.requireApi().getRooms());
  handle('getRoom', args.id, ([id]) => connection.requireApi().getRoom(id));
  handle('setRoomPower', args.idAndBoolean, ([id, on]) =>
    connection.requireApi().setRoomPower(id, on),
  );
  handle('setRoomBrightness', args.idAndPercent, ([id, brightness]) =>
    connection.requireApi().setRoomBrightness(id, brightness),
  );

  // Actions
  handle('runAction', args.action, ([action]) => actions.run(action));
  handle('getShortcutConflicts', args.none, () => shortcutConflicts);

  // Scenes
  handle('getScenes', args.none, () => connection.requireApi().getScenes());
  handle('activateScene', args.id, ([id]) => connection.requireApi().activateScene(id));

  assertAllChannelsRegistered();
}

export { broadcast, EVENT_CHANNELS };
