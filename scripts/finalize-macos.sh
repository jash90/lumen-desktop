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

if [ -z "${APPLE_API_ISSUER:-}" ]; then
  echo "finalize-macos: APPLE_API_ISSUER unset — skipping notarisation"
  exit 0
fi

ZIP="$(mktemp -d)/app.zip"
ditto -c -k --keepParent "$APP" "$ZIP"

xcrun notarytool submit "$ZIP" \
  --key "${APPLE_API_KEY_PATH:?}" \
  --key-id "${APPLE_API_KEY_ID:?}" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
