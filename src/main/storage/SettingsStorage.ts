import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import type { Settings } from '../../shared/models';

/** Non-secret preferences (PRD §29). Plain JSON on purpose — nothing here is sensitive. */

const DEFAULTS: Settings = { theme: 'system', launchAtLogin: false, favorites: [] };

export interface SettingsStorage {
  get(): Settings;
  set(patch: Partial<Settings>): Settings;
}

export function createSettingsStorage(fileName = 'settings.json'): SettingsStorage {
  const filePath = path.join(app.getPath('userData'), fileName);

  const load = (): Settings => {
    try {
      return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(filePath, 'utf8')) as Settings) };
    } catch {
      return { ...DEFAULTS };
    }
  };

  return {
    get: load,
    set(patch) {
      const next = { ...load(), ...patch };
      fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
      return next;
    },
  };
}
