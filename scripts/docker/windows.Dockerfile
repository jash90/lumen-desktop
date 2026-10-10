# Builds the Windows x64 Squirrel installer (Setup.exe, -full.nupkg, RELEASES).
# Squirrel.Windows tooling is .NET/Windows-only, so it runs under wine and mono.
# Used by scripts/release.sh --windows; always run as --platform linux/amd64.
FROM node:22-bookworm AS node

FROM electronuserland/builder:wine-mono

# The builder image's own Node may lag behind; use the same Node 22 as the Linux build.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV PATH=/usr/local/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends rsync \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
