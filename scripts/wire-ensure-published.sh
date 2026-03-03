#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="@cobuild/wire"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if [[ ! -f package.json ]]; then
  exit 0
fi

readarray -t dep_info < <(
  node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const deps = pkg.dependencies ?? {};
const devDeps = pkg.devDependencies ?? {};
if (Object.prototype.hasOwnProperty.call(deps, "@cobuild/wire")) {
  process.stdout.write("dependencies\n" + deps["@cobuild/wire"]);
} else if (Object.prototype.hasOwnProperty.call(devDeps, "@cobuild/wire")) {
  process.stdout.write("devDependencies\n" + devDeps["@cobuild/wire"]);
}
'
)

dep_section="${dep_info[0]:-}"
current_spec="${dep_info[1]:-}"

if [[ -z "$dep_section" || -z "$current_spec" ]]; then
  exit 0
fi

latest_version="$(pnpm view "$PACKAGE_NAME" version --json | tr -d '"[:space:]')"
if [[ -z "$latest_version" ]]; then
  echo "Failed to resolve latest published version for $PACKAGE_NAME." >&2
  exit 1
fi

target_spec="^$latest_version"
if [[ "$current_spec" == "$target_spec" ]]; then
  exit 0
fi

pnpm pkg set "${dep_section}.@cobuild/wire=${target_spec}"
pnpm install --lockfile-only

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add package.json
  if [[ -f pnpm-lock.yaml ]]; then
    git add pnpm-lock.yaml
  fi
fi

if [[ "$current_spec" == link:* || "$current_spec" == file:* || "$current_spec" == *"../wire"* ]]; then
  echo "Replaced local @cobuild/wire spec ($current_spec) with $target_spec."
else
  echo "Updated @cobuild/wire from $current_spec to $target_spec."
fi
