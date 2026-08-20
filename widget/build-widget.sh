#!/usr/bin/env bash
# Builds the WidgetKit extension and embeds it into a packaged Hue Desktop.app.
#
# The extension is assembled by hand rather than through an Xcode project: it is a
# single Swift file, and a .appex is just a bundle with an Info.plist and one
# executable. This keeps the whole build reproducible from the command line.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:?usage: build-widget.sh <path to Hue Desktop.app>}"

TEAM_ID="${HUE_TEAM_ID:-H2X8YGN869}"
BUNDLE_ID="com.bartlomiejzimny.huedesktop"
APP_GROUP="$TEAM_ID.$BUNDLE_ID"
WIDGET_ID="${BUNDLE_ID}.widget"
NAME="HueWidget"
BUILD="$ROOT/widget/.build"
APPEX="$BUILD/$NAME.appex"

rm -rf "$BUILD"
mkdir -p "$APPEX/Contents/MacOS"

SDK="$(xcrun --sdk macosx --show-sdk-path)"
# App extensions must enter through NSExtensionMain, not the ordinary Swift main.
# Xcode does this via "-e _NSExtensionMain"; without it the bundle registers in
# pluginkit but never appears in the widget gallery, because the process does not
# behave as an extension at all.
xcrun swiftc -sdk "$SDK" -target arm64-apple-macos14.0 -parse-as-library -O \
  -framework Foundation \
  -Xlinker -e -Xlinker _NSExtensionMain \
  "$ROOT/widget/HueWidget.swift" -o "$APPEX/Contents/MacOS/$NAME"

VERSION="$(node -p "require('$ROOT/package.json').version")"

# Xcode normally injects this build metadata. Assembling the bundle by hand means
# writing it ourselves — and without CFBundleSupportedPlatforms and the DT* keys
# the widget gallery ignores the extension even though pluginkit registers it.
SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version)"
SDK_BUILD="$(xcrun --sdk macosx --show-sdk-build-version)"
XCODE_BUILD="$(xcodebuild -version | tail -1 | awk '{print $3}')"
XCODE_VERSION="$(xcodebuild -version | head -1 | awk '{print $2}')"
XCODE_DT="$(echo "$XCODE_VERSION" | awk -F. '{printf "%d%d%d", $1, $2, ($3==""?0:$3)}')"
OS_BUILD="$(sw_vers -buildVersion)"

cat > "$APPEX/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>pl</string>
  <key>CFBundleDisplayName</key><string>Hue Desktop</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>$WIDGET_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleSupportedPlatforms</key><array><string>MacOSX</string></array>
  <key>BuildMachineOSBuild</key><string>$OS_BUILD</string>
  <key>DTCompiler</key><string>com.apple.compilers.llvm.clang.1_0</string>
  <key>DTPlatformBuild</key><string>$SDK_BUILD</string>
  <key>DTPlatformName</key><string>macosx</string>
  <key>DTPlatformVersion</key><string>$SDK_VERSION</string>
  <key>DTSDKBuild</key><string>$SDK_BUILD</string>
  <key>DTSDKName</key><string>macosx$SDK_VERSION</string>
  <key>DTXcode</key><string>$XCODE_DT</string>
  <key>DTXcodeBuild</key><string>$XCODE_BUILD</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionAttributes</key>
    <dict><key>NSExtensionPointVersion</key><string>3.0</string></dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
PLIST

# WidgetKit refuses to register an unsandboxed extension — confirmed empirically:
# without app-sandbox the .appex simply never appears in pluginkit. And once
# sandboxed, the App Group container is the only channel through which the app can
# hand data to the widget.
cat > "$BUILD/entitlements.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.application-groups</key>
  <array><string>$APP_GROUP</string></array>
</dict>
</plist>
PLIST

IDENTITY_NAME="${HUE_IDENTITY:-Developer ID Application}"
IDENTITY="$(security find-identity -v -p codesigning \
  | grep "$IDENTITY_NAME" | head -1 | awk '{print $2}')"
if [ -z "$IDENTITY" ]; then
  echo "nie znaleziono certyfikatu pasującego do: $IDENTITY_NAME" >&2
  exit 1
fi
echo "podpisuję tożsamością $IDENTITY"
codesign --force --sign "$IDENTITY" --options runtime --timestamp \
  --entitlements "$BUILD/entitlements.plist" "$APPEX"

# Helper the Electron process spawns to tell WidgetKit that state changed; living
# in Contents/MacOS means the call is attributed to the host app.
xcrun swiftc -sdk "$SDK" -target arm64-apple-macos14.0 \
  "$ROOT/widget/HueWidgetReload.swift" -o "$APP/Contents/MacOS/hue-widget-reload"
codesign --force --sign "$IDENTITY" --options runtime --timestamp \
  "$APP/Contents/MacOS/hue-widget-reload"

mkdir -p "$APP/Contents/PlugIns"
rm -rf "$APP/Contents/PlugIns/$NAME.appex"
cp -R "$APPEX" "$APP/Contents/PlugIns/"

# Embedding a new bundle invalidates the app's signature, so the host must be
# re-signed after the extension is dropped in.
codesign --force --sign "$IDENTITY" --options runtime --timestamp \
  --entitlements "$ROOT/build/entitlements.plist" "$APP"

echo "osadzono $NAME.appex w $APP"
