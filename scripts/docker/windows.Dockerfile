# Builds the Windows x64 Squirrel installer (Setup.exe, -full.nupkg, RELEASES).
# Squirrel.Windows tooling is .NET/Windows-only, so it runs under wine and mono,
# which this image ships together with Node.
# Used by scripts/release.sh --windows; always run as --platform linux/amd64.
#
# Pinned to Wine 10 (Node 22): Squirrel's helpers (rcedit.exe, WriteZipToSetup.exe)
# are 32-bit, so on Apple Silicon they run under qemu-i386, and Wine 11 (the
# current :wine-mono tag) aborts there with
#   anon_mmap_fixed: Assertion `!((UINT_PTR)start & host_page_mask)' failed.
FROM electronuserland/builder:22-wine-mono-03.25

# Squirrel.exe is .NET and runs under mono. mono's JIT aborts under amd64
# emulation on Apple Silicon (qemu: "should not be reached at tramp-amd64.c",
# Rosetta: "x86-codegen.h: offset == (gint32)offset"); the interpreter does not.
ENV MONO_ENV_OPTIONS=--interpreter

RUN apt-get update \
  && apt-get install -y --no-install-recommends rsync \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
