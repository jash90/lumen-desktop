#!/usr/bin/env bash
# The checks that gate every push and every release: lint, typecheck, tests.
#
# Installs dependencies first, but only when node_modules is missing or older
# than package-lock.json, so a warm run takes seconds rather than a minute.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

usage() {
  cat <<'EOF'
Usage: scripts/ci.sh [--help]

Runs, in order:
  npm ci            only if node_modules is missing or stale
  npm run lint      ESLint over src and tests
  npm run typecheck tsc --noEmit
  npm test          Vitest (hardware tests stay skipped unless their env vars are set)

Exits non-zero on the first failure. Used by .githooks/pre-push and scripts/release.sh.
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  '') ;;
  *) usage >&2; die "unknown argument: $1" ;;
esac

cd "$ROOT"
need node npm

# npm writes node_modules/.package-lock.json on every install; if the real lock
# file is newer, the tree no longer matches it.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  log "npm ci"
  npm ci --no-audit --no-fund
else
  info "node_modules is up to date with package-lock.json — skipping npm ci"
fi

log "lint";      timed lint npm run --silent lint
log "typecheck"; timed typecheck npm run --silent typecheck
log "test";      timed test npm test --silent

ok "ci passed"
print_timings
