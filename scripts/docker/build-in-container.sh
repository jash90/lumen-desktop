#!/usr/bin/env bash
# Runs inside the Linux/Windows builder containers started by scripts/release.sh.
#
#   /src  the repository, mounted read-only
#   /out  where out/make ends up on the host
#
# The sources are copied into the container's own filesystem without the host's
# node_modules: those were installed for macOS, and Electron, esbuild and rollup
# all ship platform-specific binaries. npm ci gives a clean Linux tree each time;
# the npm and Electron download caches are named volumes, so it stays fast.
set -euo pipefail

PLATFORM="${1:?usage: build-in-container.sh linux|win32}"

echo "==> node $(node --version), npm $(npm --version), $(uname -m)"

rsync -a --delete \
  --exclude /node_modules --exclude /out --exclude /.vite --exclude /dist \
  --exclude /.git --exclude /widget/.build --exclude /widget/Generated \
  /src/ /work/
cd /work

echo "==> npm ci"
npm ci --no-audit --no-fund

echo "==> electron-forge make --platform $PLATFORM --arch x64"
npx electron-forge make --platform "$PLATFORM" --arch x64

case "$PLATFORM" in
  linux)
    for deb in out/make/deb/x64/*.deb; do
      echo "==> $deb"; dpkg-deb --info "$deb" | sed -n '/Package:/,/Description:/p'
    done
    for rpm in out/make/rpm/x64/*.rpm; do
      echo "==> $rpm"; rpm -qip "$rpm" 2>/dev/null | grep -E '^(Name|Version|Release|Architecture)'
    done
    ;;
esac

rm -rf /out/make
mkdir -p /out/make
cp -R out/make/. /out/make/
echo "==> copied out/make to the host"
