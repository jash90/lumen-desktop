#!/usr/bin/env bash
# Writes a new version into every file that carries it and commits the change.
# Does not tag or push — scripts/release.sh does that.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

usage() {
  cat <<'EOF'
Usage: scripts/bump-version.sh X.Y.Z [--no-commit]

Updates:
  package.json, package-lock.json (root and packages[""])
  docs/index.html, docs/en/index.html (schema.org softwareVersion and the
  "Version X.Y.Z" / "Wersja X.Y.Z" line of the site)

then verifies they all agree and commits "chore: release X.Y.Z".
The widget reads its version from package.json at build time.
EOF
}

NEW=""
COMMIT=1
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --no-commit) COMMIT=0 ;;
    -*) usage >&2; die "unknown option: $arg" ;;
    *) [ -z "$NEW" ] || die "only one version expected"; NEW="$arg" ;;
  esac
done
[ -n "$NEW" ] || { usage >&2; exit 1; }
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "not a plain X.Y.Z version: $NEW"

cd "$ROOT"
need node git

OLD="$(package_version)"
[ "$OLD" != "$NEW" ] || die "package.json is already at $NEW"

if [ "$COMMIT" = 1 ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "the working tree has uncommitted changes — commit or stash them first"
fi

log "bumping $OLD → $NEW"
node - "$ROOT" "$NEW" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, version] = process.argv.slice(2);
const file = (f) => path.join(root, f);

for (const f of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(fs.readFileSync(file(f), 'utf8'));
  json.version = version;
  if (json.packages && json.packages['']) json.packages[''].version = version;
  fs.writeFileSync(file(f), JSON.stringify(json, null, 2) + '\n');
}

for (const f of ['docs/index.html', 'docs/en/index.html']) {
  const before = fs.readFileSync(file(f), 'utf8');
  const after = before
    .replace(/("softwareVersion":\s*")[^"]+(")/, `$1${version}$2`)
    .replace(/\b(Version|Wersja) \d+\.\d+\.\d+/, `$1 ${version}`);
  fs.writeFileSync(file(f), after);
}
NODE

version_report | sed 's/^/    /'
check_versions
ok "all version files at $NEW"

if [ "$COMMIT" = 1 ]; then
  git add package.json package-lock.json docs/index.html docs/en/index.html
  git commit -m "chore: release $NEW"
  ok "committed — next: scripts/release.sh"
fi
