# Shared helpers for scripts/*.sh. Source it, do not execute it.
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ -t 1 ]; then
  _BOLD=$'\033[1m'; _DIM=$'\033[2m'; _RED=$'\033[31m'; _YELLOW=$'\033[33m'; _GREEN=$'\033[32m'; _RESET=$'\033[0m'
else
  _BOLD=''; _DIM=''; _RED=''; _YELLOW=''; _GREEN=''; _RESET=''
fi

log()  { printf '%s==>%s %s\n' "$_BOLD" "$_RESET" "$*"; }
info() { printf '    %s%s%s\n' "$_DIM" "$*" "$_RESET"; }
ok()   { printf '%s  ✓%s %s\n' "$_GREEN" "$_RESET" "$*"; }
warn() { printf '%swarning:%s %s\n' "$_YELLOW" "$_RESET" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$_RED" "$_RESET" "$*" >&2; exit 1; }

need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "required tool not found: $tool"
  done
}

# The version lives in package.json; these are the other places that must agree.
package_version() { node -p "require('$ROOT/package.json').version"; }

# Prints "<file>: <version>" for every version-carrying file.
version_report() {
  node - "$ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const out = [];
out.push(['package.json', JSON.parse(read('package.json')).version]);
const lock = JSON.parse(read('package-lock.json'));
out.push(['package-lock.json', lock.version]);
out.push(['package-lock.json (packages[""])', lock.packages[''].version]);
for (const page of ['docs/index.html', 'docs/en/index.html']) {
  const html = read(page);
  const schema = /"softwareVersion":\s*"([^"]+)"/.exec(html);
  const eyebrow = /(?:Version|Wersja) (\d+\.\d+\.\d+)/.exec(html);
  out.push([`${page} (softwareVersion)`, schema ? schema[1] : 'missing']);
  out.push([`${page} (eyebrow)`, eyebrow ? eyebrow[1] : 'missing']);
}
for (const [file, version] of out) console.log(`${file}: ${version}`);
NODE
}

# Fails unless every version file carries the same version as package.json.
check_versions() {
  local expected report mismatches
  expected="$(package_version)"
  report="$(version_report)"
  mismatches="$(printf '%s\n' "$report" | awk -F': ' -v v="$expected" '$2 != v')"
  if [ -n "$mismatches" ]; then
    printf '%s\n' "$mismatches" >&2
    die "version files disagree with package.json ($expected) — run scripts/bump-version.sh $expected"
  fi
}

free_gb() { df -g "${1:-$ROOT}" | awk 'NR==2 {print $4}'; }

# Wall-clock timer for the summary at the end of a run.
_STEP_NAMES=()
_STEP_SECONDS=()
timed() {
  local name="$1"; shift
  local start=$SECONDS
  "$@"
  _STEP_NAMES+=("$name")
  _STEP_SECONDS+=("$((SECONDS - start))")
}
print_timings() {
  local i
  log "Timings"
  for i in "${!_STEP_NAMES[@]}"; do
    printf '    %-28s %4dm%02ds\n' "${_STEP_NAMES[$i]}" "$((_STEP_SECONDS[i] / 60))" "$((_STEP_SECONDS[i] % 60))"
  done
}
