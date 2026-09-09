<div align="center">

<img src="assets/icon.png" width="128" alt="Hue Desktop">

# Hue Desktop

**Control your Philips Hue lighting from the desktop — without reaching for your phone.**

A lightweight desktop app for macOS, Windows and Linux that talks to the Hue Bridge
directly over the local network. No backend, no account, no cloud.

</div>

---

<div align="center">
<img src="assets/screenshot-dashboard.png" width="380" alt="Hue Desktop dashboard">
</div>

## What it does

- **Finds the Bridge** — mDNS, `discovery.meethue.com`, the last known address, or a manually entered IP
- **Pairs** through the physical button on the Bridge and remembers it between launches
- **Controls lights** — on/off, brightness, color temperature, RGB color
- **Controls rooms** with a single `grouped_light` request instead of one command per bulb
- **Activates scenes** saved in the Hue app, grouped by room
- **Favorites** — pin a room, a light or a scene to the top of the screen
- **Menu bar** — control without opening the window, with favorites and "all off"
- **Keyboard shortcuts** that work globally, including while the app is in the background
- **Quick actions** — one click for whatever you do most often
- **Automations** created in the Hue app: view and pause them
- **Multiple Bridges** — switch between them, e.g. home and office
- **Launch at login**, straight into the menu bar
- **Reacts to outside changes** — a wall switch, the Hue app or a voice assistant
  refreshes the view instantly through the Hue API v2 event stream
- **Recovers from dropped connections** — exponential backoff, and if DHCP changes the
  Bridge address the app finds it again by its identifier

The controls follow what the hardware can do: a plain White bulb only gets a power
switch, White Ambiance adds temperature, and a color bulb gets the full picker.

## macOS widget

The app ships a WidgetKit extension — a widget showing the state of your lighting,
available in Notification Center and on the desktop. Two sizes:

- **small** — how many lights are on out of how many,
- **medium** — a list of rooms with the brightness of each.

To add it: right-click the desktop → *Edit Widgets*, find **Hue Desktop** and drag the
size you want. The app has to live in `/Applications`.

The widget **controls the lighting**: in the small size the whole tile is an
"everything on/off" switch, in the medium size each room has its own button.

It talks to the Bridge on its own, so it works **even while the app is closed**. That
requires exporting the Hue application key into a shared App Group container (a file
with `0600` permissions) — a deliberate trade-off: the key leaves the Keychain-protected
store. It only grants control over the lighting on the local network and is not an
account credential, and unpairing the Bridge deletes the file. TLS is verified exactly
as it is in the app — the same Signify CA and the same Common Name comparison against
the Bridge identifier.

When the Bridge is unreachable, the widget shows the last snapshot written by the app
instead of an empty tile.

**Refreshing:** after a button tap the state is immediate. Automatic refreshes ask for a
one-minute interval, but WidgetKit throttles them against its own budget — in practice
it works out to a few minutes.

> The extension only runs from a signed, installed bundle. In development mode
> (`npm start`) there is no app bundle, so the system has nothing to register.

## Installation

Download the latest release from [Releases](../../releases).

| System | File |
|---|---|
| macOS (Apple Silicon) | `Hue Desktop-<version>-arm64.dmg` |
| Windows | `Hue Desktop-<version> Setup.exe` |
| Linux | `.deb` / `.rpm` |

> **macOS:** releases are signed with a Developer ID certificate and notarized by Apple,
> so they open without Gatekeeper warnings.

> **Windows and Linux:** the packaging is configured, but those builds have **not been
> produced or tested yet** — see [Limitations](#limitations).

## Requirements

- A Philips Hue Bridge v2 (model BSB002) on the same network
- Firmware supporting Hue API v2 (`/clip/v2`)
- Physical access to the Bridge for the first pairing — Hue requires a button press

## Development

```bash
npm install
npm start          # runs the app in development mode
npm test           # unit and integration tests (Vitest)
npm run typecheck  # TypeScript, strict mode
npm run lint
npm run make       # builds the installers into out/make
```

A test against real hardware (skipped by default) — it performs a full TLS handshake
with the Bridge at the given address:

```bash
HUE_BRIDGE_IP=192.168.1.42 npm test
```

A signed and notarized macOS build, widget included:

```bash
HUE_SIGN=1 \
APPLE_API_KEY_PATH=~/private_keys/AuthKey_XXXXXXXX.p8 \
APPLE_API_KEY_ID=XXXXXXXX \
APPLE_API_ISSUER=<issuer-uuid> \
npm run make
```

The widget extension is built with plain `swiftc` and assembled into an `.appex` by hand
(`widget/build-widget.sh`) — there is no Xcode project, because it is a single Swift file
and an `.appex` is just a bundle with an `Info.plist` and a binary. The whole build is
reproducible from the command line. If you fork this, swap `HUE_TEAM_ID` and the App
Group identifier in `widget/HueWidget.swift` and `src/main/widget/WidgetBridge.ts`.

## Architecture

The system boundary is drawn so that the renderer never touches the network or the
credentials:

```
React (Zustand + TanStack Query)
      │  window.hue — the domain model, nothing else
      ▼
Electron preload (contextBridge)
      │  typed IPC, Zod validation on the main side
      ▼
Electron main
      │  HueApi · HueClient · HueTransport · HueEventStream
      │  BridgeDiscovery · BridgePairing · ConnectionManager · SecureStorage
      ▼  HTTPS (local)
Philips Hue Bridge  →  Zigbee  →  💡
```

The renderer has no idea what HTTPS, mDNS, CIE xy or `hue-application-key` are. It only
knows `Light`, `Room` and `Bridge`. Because of that, a change in the Hue API version
never reaches the UI layer.

### Security

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — the renderer has
  no access to any Node API
- The application key is encrypted through `safeStorage` (Keychain / DPAPI / secret
  service) and never reaches the renderer — the Bridge list passed over IPC carries the
  address and the name, but not the key
- **Exception:** the macOS widget gets a copy of the key in the App Group container
  (`0600`) so it can talk to the Bridge while the app is closed. See
  [macOS widget](#macos-widget)
- **TLS is verified, not disabled.** The Bridge presents a certificate issued by a
  private Signify CA (`CN=root-bridge`) which is in no system trust store and carries no
  `subjectAltName` field. The app bundles that CA, trusts **only** it, and replaces the
  default hostname check with an explicit Common Name comparison against the Bridge
  identifier. There is no `rejectUnauthorized: false` anywhere in the code.
- A Content Security Policy is applied to the production build

## Limitations

- **Verified on macOS only.** The Windows and Linux configuration exists, but those
  packages have never been built or run.
- **mDNS does not cross subnets**, VPNs, or some access points. When the Bridge sits on a
  different subnet than the computer, cloud discovery or a manually entered IP address
  will do the job.
- **Linux without a system password store**: when `safeStorage` reports the `basic_text`
  backend, the app shows a warning that the key is not meaningfully protected.
- **Automations can only be enabled and disabled**, not created — every `behavior_script`
  has its own configuration schema, and the Bridge runs the rules independently of this
  app.
- **Multiple Bridges work by switching the active one**, not in parallel. Controlling two
  at once would mean separating resource identifiers throughout the domain model.
- Control from outside the home network needs v2 — see [Roadmap](#roadmap).
- The macOS widget requires **macOS 14 or newer** and is available on macOS only.

## Roadmap

| Version | Scope | State |
|---|---|---|
| MVP | Bridge, lights, rooms, brightness, temperature, color, connection state | ✅ |
| v1 | Scenes, menu bar / tray, favorites, keyboard shortcuts, launch at login | ✅ |
| **v1.5** *(current)* | Multiple Bridges, quick actions, automations | ✅ |
| v2 | Hue Remote API, control from outside the home network | planned |

### v2 — what has to be settled before it starts

Control from outside the home needs the Signify cloud, and that comes with a condition
which cannot be met quietly:

- The endpoints are `https://api.meethue.com/v2/oauth2/authorize` and `/v2/oauth2/token`
  (the v1 `/oauth2` version has been deprecated since 2020), and the remote CLIP is
  `https://api.meethue.com/route/clip/v2/...` with both an `Authorization: Bearer` header
  **and** `hue-application-key`.
- **PKCE is undocumented**, so exchanging the code for a token needs a `client_secret` —
  and that cannot be shipped safely inside a desktop app. The options: (A) every user
  registers their own application on developers.meethue.com and pastes in their own
  credentials, (B) a small self-hosted token-exchange broker, (C) wait for the Hue portal
  to support PKCE.
- The pinned Signify CA from `HueTransport.ts` **must not** be used against the cloud —
  `api.meethue.com` has an ordinary public CA certificate. The remote transport is a
  separate file with Node's default validation; working around it with
  `rejectUnauthorized: false` is forbidden in this project.
- Sign-in has to go through the system browser (`shell.openExternal`), never through a
  `BrowserWindow` — the Hue account password must not pass through our process.

The feasibility comes from `HueClient`, `HueApi` and `HueMapper` depending on nothing but
the `HueTransport` interface — `HueApi` itself would not change by a single line.

## License

[MIT](LICENSE)

---

<div align="center">
<sub>Not affiliated with Signify or Philips Hue. "Philips" and "Hue" are trademarks of Signify Holding.</sub>
</div>
