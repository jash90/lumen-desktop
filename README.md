<div align="center">

English | [Polski](README.pl.md)

<img src="assets/icon.png" width="128" alt="Lumen Desktop">

# Lumen Desktop

**Control your smart lighting from the desktop — without reaching for your phone.**

A lightweight desktop app for macOS, Windows and Linux. It speaks to a Philips Hue
Bridge and to Tuya-based bulbs directly over the local network, and to everything else
through your own Home Assistant. Several hubs at once, one screen. No backend of ours,
no account, no cloud.

</div>

---

<div align="center">
<img src="assets/screenshot-dashboard.png" width="380" alt="Lumen Desktop dashboard">
</div>

## What it does

- **Several hubs at once** — a Hue Bridge in the hallway, a Tuya bulb on the desk and a
  Home Assistant covering the rest appear as one list, not three apps
- **Finds a Bridge** — mDNS, `discovery.meethue.com`, the last known address, or a
  manually entered IP; pairs through the physical button and remembers it
- **Connects to Home Assistant** with its address and a long-lived access token
- **Finds Tuya devices** by listening for what they broadcast, or by scanning an address
  range, and drives them straight over the LAN with their local key — protocols 3.3, 3.4
  and 3.5, no cloud, no hub, works without internet
- **Controls lights** — on/off, brightness, color temperature, RGB color
- **Controls rooms** with one grouped request rather than one command per bulb
- **Activates scenes** saved on the hub, grouped by room
- **Favorites** — pin a room, a light or a scene to the top of the screen
- **Menu bar** — control without opening the window, with favorites and "all off"
- **Keyboard shortcuts** that work globally, including while the app is in the background
- **Quick actions** — one click for whatever you do most often
- **Automations** created on the hub: view and pause them
- **Launch at login**, straight into the menu bar
- **Reacts to outside changes** — a wall switch, the vendor's own app or a voice
  assistant refreshes the view instantly, through the Hue v2 event stream and the Home
  Assistant WebSocket
- **Recovers from dropped connections** — exponential backoff per hub, so one going
  quiet says nothing about the others, and if DHCP changes a Bridge address the app
  finds it again by its identifier

The controls follow what the hardware can do: a plain White bulb only gets a power
switch, White Ambiance adds temperature, and a color bulb gets the full picker.

### Which bulbs does this cover?

Three ways in, in order of directness:

- **Philips Hue**, through the Bridge on your network.
- **Tuya**, straight to the device. A great many brands are Tuya underneath and never say
  so — **Spectrum Smart** among them. If a bulb pairs with the Tuya Smart or Smart Life
  app, or with a vendor app built on the same SDK, this talks to it directly. You need
  its *local key*; see [Tuya devices](#tuya-devices).
- **Everything else**, through your own Home Assistant. If Home Assistant can see a
  light, so can this — no code per brand.

### Tuya devices

A Tuya device encrypts its LAN traffic with a 16-character **local key**, issued when the
device is paired and stored in exactly two places: the device's own firmware and Tuya's
cloud. It cannot be read out of the device, so getting it means asking the cloud once:

1. Create a free project at `iot.tuya.com` — **pick the data centre your account is in**,
   Central Europe for most of the EU.
2. Subscribe the project to *IoT Core* and *Authorization Token Management*.
3. *Devices → Link App Account* and scan the QR with your app.
4. In *Add a hub → Tuya*, enter the project's **Access ID** and **Access Secret** and
   choose *Get my devices*. The app reads every device's name and local key, finds the
   devices on your network and pre-selects the lights.

The Access Secret is used for that one request and not stored. After that the cloud is
never used again — you can revoke the project's key and the app carries on. The local
keys are stored encrypted like every other credential and never leave your machine.

Already have keys, from `tinytuya wizard` or elsewhere? Type them into the device rows
instead; the account step is optional.

A device that does not show up — quiet at that moment, or behind a network that drops
broadcasts — can be found with **Scan**: it tries every address on the local network, or
one address or range you type (`192.168.1.40`, `192.168.1.0/24`), and recognises devices
by their keys.

Re-pairing a device issues a new local key, which the app reports as a lost
authorisation rather than retrying forever.

A Tuya device announces an id and nothing else — nothing says whether it is a bulb, a
socket or a thermometer. The app works that out from the data points a device reports
when it first answers, keeps the lights and tells you what the rest were, so a sensor
pasted against the wrong row does not end up in the list as a lamp with dead controls.

## macOS widget

The app ships a WidgetKit extension — a widget showing the state of your lighting,
available in Notification Center and on the desktop. Two sizes:

- **small** — how many lights are on out of how many,
- **medium** — a list of rooms with the brightness of each.

To add it: right-click the desktop → *Edit Widgets*, find **Lumen Desktop** and drag the
size you want. The app has to live in `/Applications`.

The widget **controls the lighting**: in the small size the whole tile is an
"everything on/off" switch, in the medium size each room has its own button.

It talks to the hubs on its own, so it works **even while the app is closed**. That
requires exporting credentials into a shared App Group container (a file with `0600`
permissions), and the two kinds are not treated alike:

- **Hue** is exported always. The application key only grants control over lighting on
  the local network, it is not an account credential, and unpairing deletes the file.
  TLS is verified exactly as in the app — the same Signify CA, the same Common Name
  comparison against the Bridge identifier.
- **Home Assistant is off by default.** A long-lived token grants that whole API —
  locks, cameras, alarms — and works remotely if the instance is exposed, which is
  nothing like the Hue key. Turn it on under *Settings → Widget* if you want the widget
  to switch those rooms. Left off, they still appear in the widget, as a reading rather
  than a button.

When a hub is unreachable, the widget shows the last snapshot written by the app instead
of an empty tile.

**Refreshing:** after a button tap the state is immediate. Automatic refreshes ask for a
one-minute interval, but WidgetKit throttles them against its own budget — in practice
it works out to a few minutes.

> The extension only runs from a signed, installed bundle. In development mode
> (`npm start`) there is no app bundle, so the system has nothing to register.

## Installation

Download the latest release from [Releases](../../releases).

| System | File |
|---|---|
| macOS (Apple Silicon) | `Lumen.Desktop-<version>-arm64.dmg` |
| Windows | `Lumen.Desktop-<version>.Setup.exe` |
| Linux | `.deb` / `.rpm` |

> **macOS:** releases are signed with a Developer ID certificate and notarized by Apple,
> so they open without Gatekeeper warnings.

> **Windows and Linux:** these builds are produced for every release (since 0.6.0), but
> they have **not been tested on real Windows or Linux machines yet** — see
> [Limitations](#limitations).

### Updates

**Settings → About and updates → Check for updates**, or the same item in the tray menu.
The app never checks by itself, only when you ask.

| System | What happens |
|---|---|
| macOS | The update downloads in the background, then **Restart to update** installs it. Works only in the signed release build. |
| Windows | The same through Squirrel. It needs the `RELEASES` and `.nupkg` files every release uploads. Not tested yet. |
| Linux | `.deb` and `.rpm` cannot replace themselves, so the app reports the new version and opens the release page. |
| `npm start` | No check at all, because there is no installed bundle to replace. |

The check goes through [update.electronjs.org](https://github.com/electron/update.electronjs.org),
which reads this repository's **published** GitHub Releases. Releases are published by
`scripts/release.sh` (see [RELEASING.md](RELEASING.md)), and **updates reach users only
through published, non-draft releases.**

### Upgrading from Hue Desktop

The app used to be called Hue Desktop. The rename moves everything the operating system
keys on the name, so the first launch migrates what it can and asks for the rest:

- **Settings survive** — favorites, shortcuts, quick actions and the theme are copied from
  the old data directory automatically, once.
- **The Bridge has to be paired again on macOS.** The encryption key for the stored
  application key lives in the Keychain under the *app name*, so the copied credentials
  cannot be decrypted under the new one. On Windows the credentials carry over as they are.
- **The widget has to be added again** — a new widget kind means macOS treats the tile as
  a different widget and drops the placed one.

## Requirements

At least one hub — either or both:

**Philips Hue**
- A Hue Bridge v2 (model BSB002) on the same network
- Firmware supporting Hue API v2 (`/clip/v2`)
- Physical access to the Bridge for the first pairing — Hue requires a button press

**Tuya (including Spectrum Smart and other rebrands)**
- The device on the same 2.4 GHz network — these are not 5 GHz devices
- Its local key, obtained once (see [Tuya devices](#tuya-devices))
- Protocol 3.3, 3.4 or 3.5 — the app speaks whichever the device announces

**Home Assistant**
- A reachable instance, and a long-lived access token
  (your profile → Security → Long-lived access tokens)
- The lights set up there already, and assigned to areas — areas become the rooms this
  app shows

## Development

```bash
npm install
npm start          # runs the app in development mode
npm test           # unit and integration tests (Vitest)
npm run typecheck  # TypeScript, strict mode
npm run lint
npm run make       # builds the installers into out/make
```

Tests against real hardware, skipped by default. The Hue one performs a full TLS
handshake with the Bridge; the Home Assistant one authenticates over the WebSocket and
checks that a real install's entities map onto the domain model:

```bash
HUE_BRIDGE_IP=192.168.1.42 npm test
HA_BASE_URL=http://homeassistant.local:8123 HA_TOKEN=<long-lived> npm test
```

Releases are built locally on a Mac, for all three platforms, by one script: a signed and
notarized macOS build with the widget, plus the Windows and Linux packages built in Docker.
See [RELEASING.md](RELEASING.md) for the one-time setup and the full procedure.

```bash
scripts/ci.sh                  # lint, typecheck and tests, the same checks a release runs
scripts/release.sh --dry-run   # build, sign and verify every artifact without publishing
```

The widget extension is built with plain `swiftc` and assembled into an `.appex` by hand
(`widget/build-widget.sh`) — there is no Xcode project, because it is a handful of Swift files
and an `.appex` is just a bundle with an `Info.plist` and a binary. The whole build is
reproducible from the command line. If you fork this, edit `identity.json` — the bundle
identifier, the App Group and the Team ID all derive from it, on both the Electron and the
Swift side, so there is nothing to keep in sync by hand.

## Architecture

The system boundary is drawn so that the renderer never touches the network or the
credentials:

```
React (Zustand + TanStack Query)
      │  window.lumen — the domain model, nothing else
      ▼
Electron preload (contextBridge)
      │  typed IPC, Zod validation on the main side
      ▼
Electron main
      │  ProviderRegistry — every hub live at once, merged reads,
      │  writes routed by resource id · SecureStorage
      ▼
   ProviderAdapter  (LightingApi: Light · Room · Scene · Automation)
      ├─ Hue      HueClient · HueTransport · HueEventStream   ──HTTPS──▶  Bridge ─▶ 💡
      ├─ Tuya     TuyaProtocol · TuyaTransport (TCP 6668)     ──LAN────▶  💡
      └─ HomeAss. HaClient · HaTransport · HaWebSocket        ──HTTP───▶  HA ─▶ 💡💡💡
```

The renderer has no idea what HTTPS, mDNS, CIE xy, `hue-application-key` or a bearer
token are. It only knows `Light`, `Room` and `Hub`. That is what made the second brand
cheap: `LightingApi` was already written in those terms, so adding Home Assistant meant
a new adapter behind it and no change to the UI at all.

**Adding another brand** means implementing `ProviderAdapter` in `src/main/providers/` —
`connect()` returning a `LightingApi` plus a push channel — and nothing else. Everything
above it, tray and widget included, is already brand-neutral.

Ids are deliberately **not** namespaced by provider. Hue issues UUIDs and Home Assistant
uses `light.kitchen`, so they cannot collide in practice, and prefixing them would have
invalidated every favourite, shortcut and quick action already on disk. `ResourceIndex`
routes by id and logs a warning if two hubs ever do claim the same one.

### Security

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — the renderer has
  no access to any Node API
- Credentials are encrypted through `safeStorage` (Keychain / DPAPI / secret service)
  and never reach the renderer — the hub list passed over IPC carries the address and
  the name, but neither the Hue application key nor a Home Assistant token
- **Exception:** the macOS widget gets a copy in the App Group container (`0600`) so it
  can talk to the hubs while the app is closed. Hue always; Home Assistant only if you
  turn it on, because its token is a far larger secret. See
  [macOS widget](#macos-widget)
- **Home Assistant is reached with ordinary TLS verification.** A self-signed
  certificate is something to fix on the server, not something this app waves through
- **Tuya 3.3 traffic is AES-128-ECB**, which is weak — identical blocks encrypt alike —
  but it is what that protocol specifies and such a device will not answer anything else.
  It never leaves the local network. Devices on 3.4 and 3.5 get a per-connection session
  key, HMAC-SHA256 or AES-GCM, and the app speaks whichever the device announces
- **TLS is verified, not disabled.** The Bridge presents a certificate issued by a
  private Signify CA (`CN=root-bridge`) which is in no system trust store and carries no
  `subjectAltName` field. The app bundles that CA, trusts **only** it, and replaces the
  default hostname check with an explicit Common Name comparison against the Bridge
  identifier. There is no `rejectUnauthorized: false` anywhere in the code.
- A Content Security Policy is applied to the production build

## Limitations

- **Verified on macOS only.** Every release builds the Windows and Linux packages, so they compile
  and package cleanly — but nobody has installed or run either of them.
- **mDNS does not cross subnets**, VPNs, or some access points. When the Bridge sits on a
  different subnet than the computer, cloud discovery or a manually entered IP address
  will do the job.
- **Linux without a system password store**: when `safeStorage` reports the `basic_text`
  backend, the app shows a warning that the key is not meaningfully protected.
- **Automations can only be enabled and disabled**, not created — every rule has its own
  configuration schema, and the hub runs them independently of this app.
- **Home Assistant needs its own setup.** This app is a client, not a replacement: the
  lights have to work there first, and be assigned to areas, or they show up ungrouped.
- **Home Assistant scenes never read as "active".** A scene entity's state is when it was
  last applied, so the hub simply cannot say which one is currently showing.
- **No Home Assistant discovery yet** — its address is typed in by hand.
- **Tuya offers no scenes, rooms or automations**: a device exposes none of those
  locally, so its lights appear under *Outside rooms*. Protocols 3.4 and 3.5 are tested
  against an independent implementation and a simulated device, not yet against real
  hardware on those versions.
- **Tuya devices are not controllable from the macOS widget yet** — they show there as a
  reading. The widget has no client for them.
- **Tuya discovery needs patience.** Devices announce themselves every few seconds, so a
  first pass can miss one; search again, or scan the network.
- Control from outside the home network needs v2 — see [Roadmap](#roadmap). A Home
  Assistant reachable from outside already works, at your own configuration.
- The macOS widget requires **macOS 14 or newer** and is available on macOS only.

## Roadmap

| Version | Scope | State |
|---|---|---|
| MVP | Bridge, lights, rooms, brightness, temperature, color, connection state | ✅ |
| v1 | Scenes, menu bar / tray, favorites, keyboard shortcuts, launch at login | ✅ |
| v1.5 | Multiple Bridges, quick actions, automations | ✅ |
| v2 | Provider abstraction, Home Assistant, several hubs in parallel | ✅ |
| **v2.5** *(current)* | Native Tuya over the LAN — Spectrum Smart and other rebrands | ✅ |
| v3 | Tuya in the widget, Hue Remote API | planned |

### v3 — what has to be settled before it starts

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

The feasibility comes from the same seam the Home Assistant work used: everything above
`ProviderAdapter` is written against `LightingApi`, so a remote Hue transport is another
adapter rather than a change to the domain or the UI.

## License

[MIT](LICENSE)

---

<div align="center">
<sub>Not affiliated with Signify or Philips Hue. "Philips" and "Hue" are trademarks of Signify Holding.</sub>
</div>
