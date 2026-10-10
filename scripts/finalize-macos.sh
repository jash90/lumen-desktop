#!/usr/bin/env bash
# Finishes a packaged macOS build: embeds the widget extension, then signs and
# notarises the result.
#
# Order matters. Embedding the .appex invalidates the app's signature, so the
# widget has to go in before signing, and notarisation has to come after both —
# which is why this runs as a Forge postPackage hook rather than through
# packagerConfig.osxNotarize.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:?usage: finalize-macos.sh <path to .app>}"

"$ROOT/widget/build-widget.sh" "$APP"

# Two ways to authenticate with the notary service:
#   NOTARY_PROFILE    a notarytool keychain profile — local releases (scripts/release.sh)
#   APPLE_API_*       an App Store Connect API key — the GitHub Actions fallback
if [ -n "${NOTARY_PROFILE:-}" ]; then
  NOTARY_AUTH=(--keychain-profile "$NOTARY_PROFILE")
elif [ -n "${APPLE_API_ISSUER:-}" ]; then
  NOTARY_AUTH=(--key "${APPLE_API_KEY_PATH:?}" --key-id "${APPLE_API_KEY_ID:?}" --issuer "$APPLE_API_ISSUER")
else
  echo "finalize-macos: neither NOTARY_PROFILE nor APPLE_API_ISSUER set — skipping notarisation"
  exit 0
fi

ZIP_DIR="$(mktemp -d)"
trap 'rm -rf "$ZIP_DIR"' EXIT
ZIP="$ZIP_DIR/app.zip"
ditto -c -k --keepParent "$APP" "$ZIP"

xcrun notarytool submit "$ZIP" "${NOTARY_AUTH[@]}" --wait

xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
