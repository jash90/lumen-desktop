# Builds the Linux x64 packages (.deb and .rpm) with Electron Forge.
# Used by scripts/release.sh --linux; always run as --platform linux/amd64.
FROM node:22-bookworm

# MakerRpm shells out to rpmbuild; MakerDeb needs dpkg-deb and fakeroot.
# rsync copies the sources into the container without the host's node_modules.
RUN apt-get update \
  && apt-get install -y --no-install-recommends rpm fakeroot dpkg-dev rsync \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
