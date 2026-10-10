#!/usr/bin/env bash
# Builds, signs, notarizes, verifies and publishes a Lumen Desktop release from
# this machine — macOS natively, Linux and Windows in Docker. See RELEASING.md.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

usage() {
  cat <<'EOF'
Usage: scripts/release.sh [--dry-run] [--draft] [--skip-ci] [--mac] [--linux] [--windows]

Builds the version in package.json (bump it first with scripts/bump-version.sh).

Platforms (default: all three):
  --mac        macOS arm64: signed, notarized and stapled .dmg + Squirrel.Mac .zip
  --linux      Linux x64 in Docker: .deb + .rpm
  --windows    Windows x64 in Docker (wine + mono): Squirrel Setup.exe, .nupkg, RELEASES

Options:
  --dry-run    everything except tagging and publishing; git checks only warn
  --draft      leave the GitHub release as a draft (required with a platform subset)
  --skip-ci    skip scripts/ci.sh
  -h, --help   this text

Artifacts land in dist/release/vX.Y.Z/ under the names the update feed expects.
Without --dry-run the script tags vX.Y.Z, pushes the tag, creates the GitHub
release, uploads the artifacts and publishes it as the latest release
(update.electronjs.org ignores drafts). Re-running for an existing draft
release re-uploads the assets instead of failing.

Environment:
  LOCAL_RELEASE_ENV   apple.env to source (default ~/.config/local-release/apple.env)
  MIN_FREE_GB         free disk required before building (default 15)
EOF
}

DRY_RUN=0
DRAFT=0
SKIP_CI=0
PLATFORMS=()
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --dry-run) DRY_RUN=1 ;;
    --draft) DRAFT=1 ;;
    --skip-ci) SKIP_CI=1 ;;
    --mac) PLATFORMS+=(mac) ;;
    --linux) PLATFORMS+=(linux) ;;
    --windows) PLATFORMS+=(windows) ;;
    *) usage >&2; die "unknown argument: $arg" ;;
  esac
done
ALL_PLATFORMS=0
if [ ${#PLATFORMS[@]} -eq 0 ]; then
  PLATFORMS=(mac linux windows)
  ALL_PLATFORMS=1
fi
wants() { [[ " ${PLATFORMS[*]} " == *" $1 "* ]]; }

cd "$ROOT"
need node npm git

VERSION="$(package_version)"
TAG="v$VERSION"
REPO="jash90/lumen-desktop"
PRODUCT="$(node -p "require('./identity.json').productName")"
RELEASE_DIR="$ROOT/dist/release/$TAG"
BUILD_DIR="$ROOT/dist/.build"
LINUX_IMAGE="lumen-desktop-linux-builder"
WINDOWS_IMAGE="lumen-desktop-windows-builder"
RESUME=0

# In a dry run the git checks only warn, so the pipeline can be exercised from a
# feature branch or for a version that is already released.
strict() {
  if [ "$DRY_RUN" = 1 ]; then warn "$* (ignored in --dry-run)"; else die "$*"; fi
}

# ---------------------------------------------------------------------------
preflight() {
  log "Preflight for $PRODUCT $VERSION (${PLATFORMS[*]})"

  check_versions
  ok "version files agree on $VERSION"

  if [ "$ALL_PLATFORMS" = 0 ] && [ "$DRY_RUN" = 0 ] && [ "$DRAFT" = 0 ]; then
    die "a release built for only ${PLATFORMS[*]} must be a --draft — publish it once every platform is uploaded"
  fi

  [ -z "$(git status --porcelain --untracked-files=no)" ] || strict "the working tree has uncommitted changes"
  local branch; branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" = main ] || strict "not on main (on $branch)"
  git fetch --quiet origin main --tags || strict "git fetch origin failed"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || strict "HEAD is not origin/main"
  ok "git state checked"

  local local_tag remote_tag
  local_tag="$(git rev-parse -q --verify "refs/tags/$TAG^{commit}" || true)"
  remote_tag="$(git ls-remote --tags origin "refs/tags/$TAG^{}" "refs/tags/$TAG" | awk '{print $1}' | tail -1)"
  if [ -n "$local_tag$remote_tag" ]; then
    local is_draft
    is_draft="$(gh release view "$TAG" -R "$REPO" --json isDraft --jq .isDraft 2>/dev/null || echo missing)"
    if [ "$is_draft" = true ] && [ "${local_tag:-$(git rev-parse HEAD)}" = "$(git rev-parse HEAD)" ]; then
      RESUME=1
      warn "$TAG exists with a draft release on HEAD — resuming: assets will be re-uploaded"
    else
      strict "tag $TAG already exists (release: $is_draft) — bump the version first"
    fi
  else
    ok "tag $TAG is free"
  fi

  if [ "$DRY_RUN" = 0 ]; then
    need gh
    gh auth status >/dev/null 2>&1 || die "gh is not logged in"
    ok "gh authenticated"
  fi

  if wants mac; then
    [ "$(uname -s)-$(uname -m)" = Darwin-arm64 ] || die "the macOS build needs an Apple Silicon Mac"
    need xcrun codesign security ditto hdiutil spctl xcodebuild
    local env_file="${LOCAL_RELEASE_ENV:-$HOME/.config/local-release/apple.env}"
    [ -f "$env_file" ] || die "missing $env_file — see RELEASING.md, one-time setup"
    set -a; # shellcheck disable=SC1090
    source "$env_file"; set +a
    : "${APPLE_SIGNING_IDENTITY:?not set in $env_file}" "${APPLE_TEAM_ID:?not set in $env_file}" "${NOTARY_PROFILE:?not set in $env_file}"
    grep -q "$APPLE_SIGNING_IDENTITY" <<<"$(security find-identity -v -p codesigning)" \
      || die "signing identity $APPLE_SIGNING_IDENTITY is not in the keychain"
    ok "signing identity $APPLE_SIGNING_IDENTITY"
    xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
      || die "notarytool keychain profile '$NOTARY_PROFILE' does not work"
    ok "notarytool profile $NOTARY_PROFILE"
  fi

  if wants linux || wants windows; then
    need docker
    docker info >/dev/null 2>&1 || die "Docker is not running"
    ok "Docker is running"
  fi

  local free; free="$(free_gb "$ROOT")"
  [ "$free" -ge "${MIN_FREE_GB:-15}" ] || die "only ${free} GB free, need ${MIN_FREE_GB:-15} GB"
  ok "${free} GB free"
}

# ---------------------------------------------------------------------------
run_ci() {
  if [ "$SKIP_CI" = 1 ]; then warn "skipping ci (--skip-ci)"; return; fi
  "$ROOT/scripts/ci.sh"
}

# ---------------------------------------------------------------------------
build_mac() {
  log "macOS arm64: package, embed widget, sign, notarize, staple"
  rm -rf "$ROOT/out" "$BUILD_DIR/mac"
  mkdir -p "$BUILD_DIR/mac"
  # forge.config.ts signs with APPLE_SIGNING_IDENTITY; its postPackage hook runs
  # scripts/finalize-macos.sh (widget, re-sign, notarize with NOTARY_PROFILE, staple).
  LUMEN_SIGN=1 npm run make -- --platform darwin --arch arm64

  cp "$ROOT"/out/make/*.dmg "$BUILD_DIR/mac/"
  cp "$ROOT"/out/make/zip/darwin/arm64/*.zip "$BUILD_DIR/mac/"

  local dmg; dmg="$(ls "$BUILD_DIR"/mac/*.dmg)"
  log "macOS: sign, notarize and staple the DMG"
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$dmg"
  xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$dmg"
}

verify_app() {
  local app="$1" label="$2"
  codesign --verify --deep --strict --verbose=2 "$app" 2>&1 | sed 's/^/    /'
  local assessment; assessment="$(spctl -a -vv -t exec "$app" 2>&1)"
  printf '%s\n' "$assessment" | sed 's/^/    /'
  grep -q 'source=Notarized Developer ID' <<<"$assessment" || die "$label: Gatekeeper does not see a notarized Developer ID app"
  xcrun stapler validate "$app" >/dev/null || die "$label: no stapled ticket"
  local part
  for part in "$app" "$app/Contents/PlugIns/LumenWidget.appex" \
              "$app/Contents/MacOS/$(node -p "require('./identity.json').reloadHelper")"; do
    [ -e "$part" ] || die "$label: missing $(basename "$part")"
    # Captured first: `cmd | grep -q` under pipefail fails when grep exits early.
    local details; details="$(codesign -dv "$part" 2>&1)"
    grep -q "^TeamIdentifier=$APPLE_TEAM_ID\$" <<<"$details" \
      || die "$label: $(basename "$part") is not signed by team $APPLE_TEAM_ID"
  done
  ok "$label: signature, notarization, staple, TeamIdentifier=$APPLE_TEAM_ID (app, widget, reload helper)"
}

verify_mac() {
  log "macOS: verify"
  verify_app "$ROOT/out/$PRODUCT-darwin-arm64/$PRODUCT.app" "packaged app"

  # The ZIP is what Squirrel.Mac installs, so check the app as it comes out of it.
  local unzip_dir; unzip_dir="$(mktemp -d)"
  ditto -x -k "$(ls "$BUILD_DIR"/mac/*.zip)" "$unzip_dir"
  verify_app "$unzip_dir/$PRODUCT.app" "app inside the ZIP"
  rm -rf "$unzip_dir"

  local dmg; dmg="$(ls "$BUILD_DIR"/mac/*.dmg)"
  spctl -a -vv -t open --context context:primary-signature "$dmg" 2>&1 | sed 's/^/    /'
  xcrun stapler validate "$dmg" >/dev/null || die "DMG: no stapled ticket"
  ok "DMG: signed, notarized and stapled"
}

# ---------------------------------------------------------------------------
docker_build() {
  local platform="$1" image="$2" dockerfile="$3" out="$4"
  docker build --platform linux/amd64 -t "$image" -f "$ROOT/scripts/docker/$dockerfile" "$ROOT/scripts/docker"
  rm -rf "$out"; mkdir -p "$out"
  docker run --rm --platform linux/amd64 \
    -v "$ROOT:/src:ro" \
    -v "$out:/out" \
    -v lumen-desktop-npm-cache:/root/.npm \
    -v lumen-desktop-electron-cache:/root/.cache/electron \
    "$image" bash /src/scripts/docker/build-in-container.sh "$platform"
}

build_linux() {
  log "Linux x64 in Docker: .deb + .rpm"
  docker_build linux "$LINUX_IMAGE" linux.Dockerfile "$BUILD_DIR/linux"
  ls "$BUILD_DIR"/linux/make/deb/x64/*.deb "$BUILD_DIR"/linux/make/rpm/x64/*.rpm >/dev/null \
    || die "Linux build produced no .deb/.rpm"
  ok "Linux packages built"
}

build_windows() {
  log "Windows x64 in Docker (wine + mono): Squirrel installer"
  docker_build win32 "$WINDOWS_IMAGE" windows.Dockerfile "$BUILD_DIR/windows"
  verify_windows
}

# RELEASES is how Squirrel.Windows (and update.electronjs.org) find the package:
# "<SHA1> <file> <size>". A stale line would make every update fail to apply.
verify_windows() {
  local dir="$BUILD_DIR/windows/make/squirrel.windows/x64"
  [ -f "$dir/RELEASES" ] || die "Windows build produced no RELEASES"
  local sha name size
  read -r sha name size < <(LC_ALL=C sed $'s/^\xEF\xBB\xBF//' "$dir/RELEASES" | head -1)
  [ -f "$dir/$name" ] || die "RELEASES names $name, which was not built"
  [ "$(shasum -a 1 "$dir/$name" | awk '{print toupper($1)}')" = "$(tr '[:lower:]' '[:upper:]' <<<"$sha")" ] \
    || die "RELEASES SHA-1 does not match $name"
  [ "$(stat -f %z "$dir/$name")" = "$size" ] || die "RELEASES size does not match $name"
  ls "$dir"/*Setup.exe >/dev/null || die "Windows build produced no Setup.exe"
  ok "RELEASES matches $name ($size bytes, SHA-1 $sha)"
}

# ---------------------------------------------------------------------------
# GitHub turns spaces in asset names into dots; renaming here keeps the local
# names identical to the published ones (e.g. Lumen.Desktop-0.6.0-arm64.dmg).
collect() {
  log "Collecting artifacts into ${RELEASE_DIR#"$ROOT"/}"
  rm -rf "$RELEASE_DIR"; mkdir -p "$RELEASE_DIR"
  local files=()
  wants mac && files+=("$BUILD_DIR"/mac/*.dmg "$BUILD_DIR"/mac/*.zip)
  wants linux && files+=("$BUILD_DIR"/linux/make/deb/x64/*.deb "$BUILD_DIR"/linux/make/rpm/x64/*.rpm)
  wants windows && files+=("$BUILD_DIR"/windows/make/squirrel.windows/x64/*Setup.exe
                           "$BUILD_DIR"/windows/make/squirrel.windows/x64/*-full.nupkg
                           "$BUILD_DIR"/windows/make/squirrel.windows/x64/RELEASES)
  local f base
  for f in "${files[@]}"; do
    [ -f "$f" ] || die "missing artifact: $f"
    base="$(basename "$f")"
    cp "$f" "$RELEASE_DIR/${base// /.}"
  done
  (cd "$RELEASE_DIR" && shasum -a 256 -- * > "$BUILD_DIR/SHA256SUMS-$TAG.txt")
  for f in "$RELEASE_DIR"/*; do
    printf '    %10d  %s\n' "$(stat -f %z "$f")" "$(basename "$f")"
  done
  info "SHA-256 sums: ${BUILD_DIR#"$ROOT"/}/SHA256SUMS-$TAG.txt"
}

# ---------------------------------------------------------------------------
publish() {
  if [ "$DRY_RUN" = 1 ]; then
    log "Dry run — not tagging or publishing. Artifacts: ${RELEASE_DIR#"$ROOT"/}"
    return
  fi
  if [ "$RESUME" = 0 ]; then
    log "Tagging $TAG"
    git tag -a "$TAG" -m "$PRODUCT $VERSION"
    git push origin "refs/tags/$TAG"
    gh release create "$TAG" -R "$REPO" --verify-tag --title "$TAG" --generate-notes --draft
  fi
  log "Uploading assets"
  gh release upload "$TAG" -R "$REPO" --clobber "$RELEASE_DIR"/*
  if [ "$DRAFT" = 1 ]; then
    ok "draft release ready: $(gh release view "$TAG" -R "$REPO" --json url --jq .url)"
  else
    gh release edit "$TAG" -R "$REPO" --draft=false --latest
    ok "published: $(gh release view "$TAG" -R "$REPO" --json url --jq .url)"
  fi
}

# ---------------------------------------------------------------------------
STARTED=$SECONDS
timed preflight preflight
timed ci run_ci
if wants mac; then timed "build mac" build_mac; timed "verify mac" verify_mac; fi
if wants linux; then timed "build linux (docker)" build_linux; fi
if wants windows; then timed "build windows (docker)" build_windows; fi
timed collect collect
timed publish publish
print_timings
info "total $(( (SECONDS - STARTED) / 60 ))m$(( (SECONDS - STARTED) % 60 ))s"
