import { app, nativeTheme } from 'electron';

import { EVENT_CHANNELS } from '../../shared/ipc';
import type { BridgeDiscoveryService } from '../bridge/BridgeDiscoveryService';
import type { BridgePairingService } from '../bridge/BridgePairingService';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { ProviderRepository } from '../providers/ProviderRepository';
import type { ActionRunner } from '../actions/ActionRunner';
import type { ShortcutRegistrar } from '../shortcuts/GlobalShortcuts';
import type { SecureStorage } from '../storage/SecureStorage';
import type { SettingsStorage } from '../storage/SettingsStorage';
import { applyLoginItem } from '../autostart';
import { args, assertAllChannelsRegistered, broadcast, handle } from './handlers';

export interface IpcContext {
  actions: ActionRunner;
  shortcuts: ShortcutRegistrar;
  providers: ProviderRegistry;
  repository: ProviderRepository;
  discovery: BridgeDiscoveryService;
  pairing: BridgePairingService;
  storage: SecureStorage;
  settings: SettingsStorage;
}

/**
 * Registers the whole PRD §17 contract. Kept in one file because the handlers are
 * one-liners over the services — splitting them per resource would add files
 * without adding structure.
 */
export function registerIpcHandlers(context: IpcContext): void {
  const { actions, shortcuts, providers, repository, discovery, pairing, storage, settings } =
    context;

  /** Last result of applying the stored shortcuts; see getShortcutConflicts. */
  let shortcutConflicts: string[] = [];

  const applyShortcuts = (): void => {
    shortcutConflicts = shortcuts.apply(settings.get().shortcuts);
  };
  applyShortcuts();

  handle('getVersion', args.none, () => app.getVersion());

  // Hubs
  handle('discoverBridges', args.none, () => discovery.discover());

  handle('pairBridge', args.ip, async ([ip]) => {
    // Pairing only stores the credential; connecting it is the registry's job.
    const summary = await pairing.pair(ip);
    const credential = repository.get(summary.id);
    if (credential) await providers.add(credential);
    return summary;
  });

  handle('cancelPairing', args.none, () => {
    pairing.cancel();
  });

  // hubs() is deliberately a projection rather than the stored record: an
  // application key or an access token must never reach the renderer.
  handle('listHubs', args.none, () => providers.hubs());
  handle('getConnectionStatuses', args.none, () => providers.statuses());
  handle('reconnectHubs', args.none, () => providers.reconnectAll());
  handle('removeHub', args.id, ([id]) => providers.remove(id));
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
  handle('getLights', args.none, () => providers.getLights());
  handle('getLight', args.id, ([id]) => providers.getLight(id));
  handle('setLightPower', args.idAndBoolean, ([id, on]) =>
    providers.setLightPower(id, on),
  );
  handle('setLightBrightness', args.idAndPercent, ([id, brightness]) =>
    providers.setLightBrightness(id, brightness),
  );
  handle('setLightColor', args.idAndColor, ([id, color]) =>
    providers.setLightColor(id, color),
  );
  handle('setLightTemperature', args.idAndPercent, ([id, temperature]) =>
    providers.setLightTemperature(id, temperature),
  );

  // Rooms
  handle('getRooms', args.none, () => providers.getRooms());
  handle('getRoom', args.id, ([id]) => providers.getRoom(id));
  handle('setRoomPower', args.idAndBoolean, ([id, on]) =>
    providers.setRoomPower(id, on),
  );
  handle('setRoomBrightness', args.idAndPercent, ([id, brightness]) =>
    providers.setRoomBrightness(id, brightness),
  );

  // Automations
  handle('getAutomations', args.none, () => providers.getAutomations());
  handle('setAutomationEnabled', args.idAndBoolean, ([id, enabled]) =>
    providers.setAutomationEnabled(id, enabled),
  );

  // Actions
  handle('runAction', args.action, ([action]) => actions.run(action));
  handle('getShortcutConflicts', args.none, () => shortcutConflicts);

  // Scenes
  handle('getScenes', args.none, () => providers.getScenes());
  handle('activateScene', args.id, ([id]) => providers.activateScene(id));

  assertAllChannelsRegistered();
}

export { broadcast, EVENT_CHANNELS };
