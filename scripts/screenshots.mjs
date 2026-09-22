#!/usr/bin/env node
/**
 * Regenerates the screenshots used by the GitHub Pages site in docs/.
 *
 *   node scripts/screenshots.mjs
 *
 * The renderer only ever talks to `window.lumen` (src/shared/ipc.ts), so it can
 * run in a plain browser: Vite serves it exactly as `npm start` would, and an
 * init script stands in for the preload bridge with fictional hubs, rooms and
 * lights. No hub hardware, no Electron, and no change to the app itself.
 *
 * Output: docs/assets/screens/<screen>-<light|dark>.webp and docs/assets/og-image-<pl|en>.jpg
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'assets', 'screens');
const PORT = 5199;
const URL = `http://localhost:${PORT}/`;

// The Electron window is created at 460×760 (src/main/index.ts) and is not
// meant to be resized into a phone or a full-screen layout, so that is the
// viewport. A 2× scale keeps text sharp on high-density screens.
const VIEWPORT = { width: 460, height: 760 };
const SCALE = 2;
const WEBP_QUALITY = 0.86;

/* ------------------------------------------------------------------------- */
/* Fictional home. Names, addresses and ids are made up; nothing here is real. */
/* ------------------------------------------------------------------------- */

const fixture = () => {
  const hubs = [
    { id: 'hub-hue', kind: 'hue', name: 'Hue Bridge', address: '192.168.1.20', modelId: 'BSB002', swVersion: '1967054020' },
    { id: 'hub-ha', kind: 'homeassistant', name: 'Home Assistant', address: 'http://homeassistant.local:8123' },
    { id: 'hub-tuya', kind: 'tuya', name: 'Tuya (local)', address: 'local network' },
  ];

  const full = { dimming: true, colorTemperature: true, color: true };
  const ambiance = { dimming: true, colorTemperature: true, color: false };
  const white = { dimming: true, colorTemperature: false, color: false };

  const lights = [
    { id: 'l-ceiling', providerId: 'hub-hue', name: 'Ceiling', roomId: 'r-living', isOn: true, brightness: 78, color: { r: 255, g: 176, b: 102 }, colorTemperature: 22, capabilities: full },
    { id: 'l-floor', providerId: 'hub-hue', name: 'Floor lamp', roomId: 'r-living', isOn: true, brightness: 45, colorTemperature: 15, capabilities: ambiance },
    { id: 'l-tv', providerId: 'hub-hue', name: 'TV light strip', roomId: 'r-living', isOn: true, brightness: 60, color: { r: 138, g: 92, b: 255 }, capabilities: full },
    { id: 'l-kitchen', providerId: 'hub-hue', name: 'Kitchen ceiling', roomId: 'r-kitchen', isOn: true, brightness: 100, colorTemperature: 70, capabilities: ambiance },
    { id: 'l-counter', providerId: 'hub-hue', name: 'Under-cabinet', roomId: 'r-kitchen', isOn: false, brightness: 80, capabilities: white },
    { id: 'l-desk', providerId: 'hub-ha', name: 'Desk lamp', roomId: 'r-office', isOn: true, brightness: 70, colorTemperature: 55, capabilities: ambiance },
    { id: 'l-shelf', providerId: 'hub-ha', name: 'Bookshelf', roomId: 'r-office', isOn: false, brightness: 40, capabilities: { dimming: false, colorTemperature: false, color: false } },
    { id: 'l-bed-l', providerId: 'hub-ha', name: 'Bedside left', roomId: 'r-bedroom', isOn: false, brightness: 30, colorTemperature: 10, capabilities: ambiance },
    { id: 'l-bed-r', providerId: 'hub-ha', name: 'Bedside right', roomId: 'r-bedroom', isOn: false, brightness: 30, colorTemperature: 10, capabilities: ambiance },
    { id: 'l-hall', providerId: 'hub-tuya', name: 'Hallway bulb', roomId: null, isOn: true, brightness: 50, color: { r: 255, g: 120, b: 150 }, colorTemperature: 40, capabilities: full },
    { id: 'l-porch', providerId: 'hub-tuya', name: 'Porch bulb', roomId: null, isOn: false, brightness: 100, colorTemperature: 30, capabilities: full },
  ];

  const room = (id, providerId, name, groupControl = true) => {
    const members = lights.filter((light) => light.roomId === id);
    const lit = members.filter((light) => light.isOn);
    return {
      id,
      providerId,
      name,
      lightIds: members.map((light) => light.id),
      isOn: lit.length > 0,
      brightness: lit.length ? Math.round(lit.reduce((sum, l) => sum + l.brightness, 0) / lit.length) : 0,
      supportsGroupControl: groupControl,
    };
  };

  const rooms = [
    room('r-living', 'hub-hue', 'Living room'),
    room('r-kitchen', 'hub-hue', 'Kitchen'),
    room('r-office', 'hub-ha', 'Office'),
    room('r-bedroom', 'hub-ha', 'Bedroom'),
  ];

  const scenes = [
    { id: 's-relax', providerId: 'hub-hue', name: 'Relax', roomId: 'r-living', isActive: true },
    { id: 's-read', providerId: 'hub-hue', name: 'Read', roomId: 'r-living', isActive: false },
    { id: 's-movie', providerId: 'hub-hue', name: 'Movie night', roomId: 'r-living', isActive: false },
    { id: 's-bright', providerId: 'hub-hue', name: 'Bright', roomId: 'r-living', isActive: false },
    { id: 's-cook', providerId: 'hub-hue', name: 'Cooking', roomId: 'r-kitchen', isActive: false },
    { id: 's-dinner', providerId: 'hub-hue', name: 'Dinner', roomId: 'r-kitchen', isActive: false },
    { id: 's-focus', providerId: 'hub-ha', name: 'Focus', roomId: 'r-office', isActive: false },
    { id: 's-night', providerId: 'hub-ha', name: 'Nightlight', roomId: 'r-bedroom', isActive: false },
  ];

  const automations = [
    { id: 'a-wake', providerId: 'hub-hue', name: 'Wake up gently', enabled: true },
    { id: 'a-sunset', providerId: 'hub-hue', name: 'Living room at sunset', enabled: true },
    { id: 'a-motion', providerId: 'hub-hue', name: 'Hallway motion sensor', enabled: true },
    { id: 'a-dimmer', providerId: 'hub-hue', name: 'Kitchen dimmer switch', enabled: true },
    { id: 'a-away', providerId: 'hub-hue', name: 'Leaving home', enabled: false },
    { id: 'a-bed', providerId: 'hub-ha', name: 'Bedtime', enabled: false },
  ];

  const settings = {
    theme: 'system',
    launchAtLogin: true,
    exportHomeAssistantToWidget: false,
    quickActions: [
      { id: 'qa-1', label: 'All off', action: { kind: 'allOff' } },
      { id: 'qa-2', label: 'Scene: Relax', action: { kind: 'activateScene', id: 's-relax' } },
      { id: 'qa-3', label: 'Toggle: Kitchen', action: { kind: 'toggleRoom', id: 'r-kitchen' } },
    ],
    shortcuts: [
      { accelerator: 'CommandOrControl+Alt+O', action: { kind: 'allOff' } },
      { accelerator: 'CommandOrControl+Alt+R', action: { kind: 'activateScene', id: 's-relax' } },
    ],
    favorites: [
      { type: 'scene', id: 's-relax' },
      { type: 'scene', id: 's-focus' },
      { type: 'light', id: 'l-desk' },
    ],
  };

  const statuses = hubs.map((hub) => ({
    providerId: hub.id,
    kind: hub.kind,
    state: 'connected',
    hub,
    ...(hub.kind === 'tuya' ? { detail: '2 devices' } : {}),
  }));

  return { hubs, lights, rooms, scenes, automations, settings, statuses };
};

/**
 * Runs in the page before React mounts. Mirrors LumenApi: every invoke returns
 * a Result, every on* returns an unsubscribe. Writes update the in-memory state
 * so clicking around behaves like the real thing.
 */
function installMock({ data, onboarding }) {
  const state = structuredClone(data);
  if (onboarding) state.hubs = [];
  const ok = (value) => Promise.resolve({ ok: true, data: structuredClone(value) });
  const find = (list, id) => list.find((item) => item.id === id);

  window.lumen = {
    getVersion: () => ok('0.4.1'),
    discoverBridges: () => ok([{ id: 'ecb5fafffe0a1b2c', ip: '192.168.1.20', name: 'Hue Bridge', source: 'mdns' }]),
    pairBridge: () => new Promise(() => {}),
    cancelPairing: () => ok(undefined),
    connectHomeAssistant: () => new Promise(() => {}),
    discoverTuyaDevices: () =>
      ok([
        { deviceId: 'bf3a1c7d9e2f4a6b8c0d', address: '192.168.1.51', version: '3.3', name: 'Hallway bulb' },
        { deviceId: 'bf9e8d7c6b5a4f3e2d1c', address: '192.168.1.52', version: '3.3', name: 'Porch bulb' },
      ]),
    connectTuya: () => new Promise(() => {}),
    reconnectHubs: () => ok(state.statuses),
    getConnectionStatuses: () => ok(onboarding ? [] : state.statuses),
    getStorageHealth: () => ok({ encryptionAvailable: true, backend: null, weak: false }),
    listHubs: () => ok(state.hubs),
    removeHub: () => ok(undefined),
    getSettings: () => ok(state.settings),
    setSettings: (patch) => {
      Object.assign(state.settings, patch);
      return ok(state.settings);
    },
    getLights: () => ok(state.lights),
    getLight: (id) => ok(find(state.lights, id)),
    setLightPower: (id, on) => ((find(state.lights, id).isOn = on), ok(undefined)),
    setLightBrightness: (id, value) => ((find(state.lights, id).brightness = value), ok(undefined)),
    setLightColor: (id, color) => ((find(state.lights, id).color = color), ok(undefined)),
    setLightTemperature: (id, value) => ((find(state.lights, id).colorTemperature = value), ok(undefined)),
    getRooms: () => ok(state.rooms),
    getRoom: (id) => ok(find(state.rooms, id)),
    setRoomPower: (id, on) => ((find(state.rooms, id).isOn = on), ok(undefined)),
    setRoomBrightness: (id, value) => ((find(state.rooms, id).brightness = value), ok(undefined)),
    getScenes: () => ok(state.scenes),
    activateScene: (id) => {
      const target = find(state.scenes, id);
      state.scenes.forEach((scene) => {
        if (scene.roomId === target.roomId) scene.isActive = scene.id === id;
      });
      return ok(undefined);
    },
    getAutomations: () => ok(state.automations),
    setAutomationEnabled: (id, enabled) => ((find(state.automations, id).enabled = enabled), ok(undefined)),
    runAction: () => ok(undefined),
    getShortcutConflicts: () => ok([]),
    onLightChanged: () => () => {},
    onRoomChanged: () => () => {},
    onConnectionChanged: () => () => {},
    onPairingState: () => () => {},
  };
}

/* ------------------------------------------------------------------------- */
/* Screens: how to reach each one from a fresh load.                          */
/* ------------------------------------------------------------------------- */

const SCREENS = [
  { name: 'dashboard', steps: async () => {} },
  {
    name: 'room',
    steps: async (page) => {
      await page.getByRole('button', { name: /^Living room/ }).first().click();
      await page.getByRole('heading', { level: 1, name: 'Living room' }).waitFor();
    },
  },
  {
    name: 'light',
    steps: async (page) => {
      await page.getByRole('button', { name: /^Ceiling/ }).first().click();
      await page.locator('.react-colorful').waitFor();
    },
  },
  {
    name: 'automations',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Automations', exact: true }).click();
      await page.getByText('Wake up gently').waitFor();
    },
  },
  {
    name: 'settings',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Settings' }).waitFor();
    },
  },
  {
    name: 'shortcuts',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByText('Quick actions and shortcuts').scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent === 'Quick actions and shortcuts');
        heading.scrollIntoView({ block: 'start' });
        document.querySelector('main').scrollBy(0, -12);
      });
    },
  },
  {
    name: 'onboarding',
    onboarding: true,
    steps: async (page) => {
      await page.getByText('Bridges found').waitFor();
      await page.getByText('192.168.1.20').first().waitFor();
    },
  },
  {
    name: 'onboarding-tuya',
    onboarding: true,
    steps: async (page) => {
      await page.getByRole('button', { name: 'Tuya', exact: true }).click();
      await page.getByText('Devices found').waitFor();
      await page.getByText('Porch bulb').first().waitFor();
    },
  },
];

/* ------------------------------------------------------------------------- */

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not come up on ${url}`);
}

/** Chromium encodes WebP itself, so there is no image tool to install. */
async function toWebp(browser, png) {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(
    async ({ b64, quality }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', quality);
    },
    { b64: png.toString('base64'), quality: WEBP_QUALITY },
  );
  await page.close();
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const vite = spawn('npx', ['vite', '--config', 'vite.renderer.config.mts', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const browser = await chromium.launch();
  const data = fixture();

  try {
    await waitForServer(URL);

    for (const colorScheme of ['light', 'dark']) {
      for (const screen of SCREENS) {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: SCALE,
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

        await page.addInitScript(installMock, { data, onboarding: Boolean(screen.onboarding) });
        await page.goto(URL);
        await page.locator('#root > *').first().waitFor();
        if (!screen.onboarding) await page.getByText('Living room').first().waitFor();
        await screen.steps(page);
        await page.waitForTimeout(400);

        const png = await page.screenshot({ animations: 'disabled' });
        const webp = await toWebp(browser, png);
        const file = path.join(OUT, `${screen.name}-${colorScheme}.webp`);
        await writeFile(file, webp);
        console.log(`${path.relative(ROOT, file)}  ${(webp.length / 1024).toFixed(0)} KB`);

        if (errors.length) console.warn(`  console errors on ${screen.name}:`, errors);
        await context.close();
      }
    }

    for (const og of OG_IMAGES) await renderOgImage(browser, og);
  } finally {
    await browser.close();
    vite.kill();
  }
}

/** One social preview per site language — the tagline is the only difference. */
const OG_IMAGES = [
  { file: 'og-image-pl.jpg', tagline: 'Oświetlenie Philips Hue, Tuya i Home Assistant — sterowane z pulpitu, lokalnie.' },
  { file: 'og-image-en.jpg', tagline: 'Philips Hue, Tuya and Home Assistant lights — controlled from your desktop, locally.' },
];

/** 1200×630 social preview: the icon, the name and two real screenshots. */
async function renderOgImage(browser, { file: name, tagline }) {
  const icon = (await readFile(path.join(ROOT, 'assets', 'icon.png'))).toString('base64');
  const shot = async (name) =>
    (await readFile(path.join(OUT, name))).toString('base64');
  const light = await shot('dashboard-light.webp');
  const dark = await shot('light-dark.webp');

  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <div style="width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box;
      background:radial-gradient(120% 140% at 0% 100%, oklch(76% 0.16 65 / .55), transparent 55%),
                 radial-gradient(90% 120% at 100% 0%, oklch(55% 0.22 300 / .6), transparent 60%), oklch(17% 0.012 265);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f4f5f8;overflow:hidden">
      <div style="flex:1">
        <img src="data:image/png;base64,${icon}" width="112" height="112" style="margin-left:-12px">
        <div style="font-size:64px;font-weight:700;letter-spacing:-.03em;margin-top:12px">Lumen Desktop</div>
        <div style="font-size:28px;line-height:1.35;margin-top:14px;color:#c9ccd6;max-width:520px">
          ${tagline}</div>
      </div>
      <div style="position:relative;width:520px;height:630px">
        <img src="data:image/webp;base64,${light}" style="position:absolute;left:0;top:70px;width:250px;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
        <img src="data:image/webp;base64,${dark}" style="position:absolute;left:220px;top:130px;width:250px;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6)">
      </div>
    </div></body></html>`);
  await page.waitForLoadState('load');
  const file = path.join(ROOT, 'docs', 'assets', name);
  await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
  console.log(path.relative(ROOT, file));
  await page.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
