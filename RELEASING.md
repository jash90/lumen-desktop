# Releasing Lumen Desktop

Releases are built on a developer Mac, not on GitHub Actions: macOS runner minutes cost
10× and Windows 2× the Linux rate, and the Mac already has the signing certificate. One
command builds all three platforms, signs and notarizes the macOS build, verifies
everything and publishes the GitHub release that the in-app updater reads.

```bash
scripts/bump-version.sh 0.7.0   # writes the version everywhere, commits "chore: release 0.7.0"
git push origin main            # (through a PR if main is protected)
scripts/release.sh              # build, sign, notarize, verify, tag, publish
```

## One-time machine setup

| What | Where | Check |
|---|---|---|
| Apple Silicon Mac, Xcode (for `swiftc`, `notarytool`, `stapler`, the macOS SDK) | — | `xcrun --show-sdk-path` |
| Node 22+ and npm | — | `node --version` |
| Docker Desktop, ≥ 40 GB VM disk (Linux and Windows builds run as `linux/amd64`) | — | `docker info` |
| GitHub CLI, logged in with push access to `jash90/lumen-desktop` | — | `gh auth status` |
| Developer ID Application certificate + private key | login keychain | `security find-identity -v -p codesigning` |
| notarytool keychain profile | login keychain | `xcrun notarytool history --keychain-profile local-release` |
| Release settings | `~/.config/local-release/apple.env` | see below |

`~/.config/local-release/apple.env` holds non-secret settings and is sourced by
`scripts/release.sh` (override the path with `LOCAL_RELEASE_ENV`):

```bash
APPLE_ID=you@example.com
APPLE_TEAM_ID=H2X8YGN869
APPLE_SIGNING_IDENTITY=<SHA-1 of the Developer ID Application certificate>
NOTARY_PROFILE=local-release
```

`APPLE_SIGNING_IDENTITY` is a SHA-1, not a name: this keychain holds two identical
"Developer ID Application" certificates, and signing by name picks either. Get the hash
from `security find-identity -v -p codesigning`.

The notary credentials live only in the keychain. Create the profile once with an
app-specific password from [appleid.apple.com](https://appleid.apple.com):

```bash
xcrun notarytool store-credentials local-release \
  --apple-id you@example.com --team-id H2X8YGN869
```

Optionally run the checks before every push:

```bash
git config core.hooksPath .githooks   # .githooks/pre-push runs scripts/ci.sh
```

## The scripts

### `scripts/ci.sh`

`npm ci` (only when `node_modules` is missing or older than `package-lock.json`), then
`npm run lint`, `npm run typecheck` and `npm test`. This is the whole CI — there is no
`ci.yml`.

### `scripts/bump-version.sh X.Y.Z [--no-commit]`

Writes the version into `package.json`, `package-lock.json` and the two pages of the
site (`docs/index.html`, `docs/en/index.html`), checks they all agree and commits
`chore: release X.Y.Z`. It does not tag or push. The widget takes its version from
`package.json` at build time.

### `scripts/release.sh [--dry-run] [--draft] [--skip-ci] [--mac] [--linux] [--windows]`

Without platform flags it builds all three. Steps, in order:

1. **Preflight** — version files agree; the tree is clean; on `main` and equal to
   `origin/main`; tag `vX.Y.Z` exists neither locally nor on GitHub; `gh` is logged in;
   for macOS the signing identity is in the keychain and the notary profile works; Docker
   is running for Linux/Windows; at least 15 GB free (`MIN_FREE_GB`).
2. **`scripts/ci.sh`** (skip with `--skip-ci`).
3. **macOS arm64** — `LUMEN_SIGN=1 npm run make -- --platform darwin --arch arm64`.
   Electron Forge signs the app with `APPLE_SIGNING_IDENTITY` (hardened runtime,
   `build/entitlements.plist`), then its `postPackage` hook runs
   `scripts/finalize-macos.sh`: builds the WidgetKit extension with `swiftc`
   (`widget/build-widget.sh`), embeds and signs it, re-signs the app, notarizes it with
   `NOTARY_PROFILE` and staples the ticket. The DMG and ZIP makers then package the
   stapled app. Finally the DMG itself is signed, notarized and stapled.
4. **Verify macOS** — for the packaged app *and* the app unpacked from the ZIP (the ZIP
   is what Squirrel.Mac installs): `codesign --verify --deep --strict`,
   `spctl -a -vv` must report `Notarized Developer ID`, `xcrun stapler validate`, and
   `TeamIdentifier` of the app, the widget and the widget reload helper. The DMG gets
   `spctl -t open` and `stapler validate`.
5. **Linux x64** — `scripts/docker/linux.Dockerfile` (`node:22-bookworm` + `rpm`,
   `fakeroot`) runs `scripts/docker/build-in-container.sh`: the repository is mounted
   read-only and copied into the container *without* `node_modules`, `npm ci` installs
   Linux binaries, and `electron-forge make --platform linux --arch x64` produces the
   `.deb` and `.rpm`. The npm and Electron download caches are Docker volumes
   (`lumen-desktop-npm-cache`, `lumen-desktop-electron-cache`).
6. **Windows x64** — the same in `scripts/docker/windows.Dockerfile`
   (`electronuserland/builder:wine-mono`): Squirrel.Windows needs wine and mono to build
   `Setup.exe`, the `-full.nupkg` and `RELEASES`. The script checks that `RELEASES`
   names the built `.nupkg` with its exact SHA-1 and size — Squirrel and the update feed
   rely on that line.
7. **Collect** into `dist/release/vX.Y.Z/` (gitignored), renaming spaces to dots so the
   local names equal the published ones. SHA-256 sums go to `dist/.build/`.
8. **Publish** (skipped by `--dry-run`) — annotated tag `vX.Y.Z`, push the tag,
   `gh release create --generate-notes` as a draft, upload the assets, then publish it as
   the latest release. `--draft` stops before publishing. Re-running for a tag whose
   release is still a draft re-uploads the assets (`--clobber`) instead of failing.

A release must be **published**, not a draft: the in-app updater asks
[update.electronjs.org](https://github.com/electron/update.electronjs.org), which only
serves published releases.

Release assets (names must stay stable — the update feed and the README point at them):

| Asset | Platform |
|---|---|
| `Lumen.Desktop-X.Y.Z-arm64.dmg` | macOS installer |
| `Lumen.Desktop-darwin-arm64-X.Y.Z.zip` | macOS update (Squirrel.Mac) |
| `Lumen.Desktop-X.Y.Z.Setup.exe` | Windows installer |
| `lumen_desktop-X.Y.Z-full.nupkg`, `RELEASES` | Windows update (Squirrel.Windows) |
| `lumen-desktop_X.Y.Z_amd64.deb`, `lumen-desktop-X.Y.Z-1.x86_64.rpm` | Linux |

### Building one platform

A subset of platforms has to be a draft, so that users never see a release with half
its files:

```bash
scripts/release.sh --mac --draft
scripts/release.sh --linux --windows --draft   # resumes: same tag, still a draft
gh release edit vX.Y.Z -R jash90/lumen-desktop --draft=false --latest
```

`--dry-run` works from any branch and any version; it builds, signs and notarizes for
real and only skips the tag and the release.

## Troubleshooting

- **`signing identity … is not in the keychain`** — the certificate or its private key
  is missing, or `APPLE_SIGNING_IDENTITY` is stale. Compare with
  `security find-identity -v -p codesigning`.
- **`notarytool keychain profile … does not work`** — recreate it with
  `xcrun notarytool store-credentials` (app-specific passwords can be revoked).
- **Notarization `Invalid`** — `xcrun notarytool log <submission-id> --keychain-profile local-release`
  lists every file Apple rejected; usually something unsigned or without the hardened runtime.
- **`stapler staple` fails with "Record not found"** — notarization did not succeed;
  see above.
- **Docker: `no space left on device`** — `docker system df`, then
  `docker builder prune` / `docker volume rm lumen-desktop-npm-cache`. The VM disk is set
  in Docker Desktop → Settings → Resources.
- **Linux/Windows build is slow** — it runs under amd64 emulation on Apple Silicon;
  expect several minutes. The first run also downloads the images and fills the caches.
- **`RELEASES SHA-1 does not match`** — the Squirrel output is inconsistent; delete
  `dist/.build/windows` and rebuild Windows.
- **Tag already exists** — every release needs a new version: `scripts/bump-version.sh`.
  If a run died after tagging and the release is still a draft, just run it again.

## Manual fallback: GitHub Actions

`.github/workflows/release.yml` still builds all three platforms on GitHub-hosted
runners, but only when started by hand (Actions → Release → Run workflow). Run it on a
`vX.Y.Z` tag to get a **draft** release with the artifacts, which then has to be
published by hand. It signs and notarizes macOS only when these repository secrets
exist: `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_API_KEY` (base64 `.p8`),
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — `scripts/finalize-macos.sh` falls back to the
App Store Connect API key when `NOTARY_PROFILE` is not set.
