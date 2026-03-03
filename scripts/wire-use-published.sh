#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if [[ $# -gt 0 ]]; then
  TARGET="$1"
else
  latest_version="$(pnpm view @cobuild/wire version --json | tr -d '"[:space:]')"
  if [[ -z "$latest_version" ]]; then
    echo "Failed to resolve latest published version for @cobuild/wire." >&2
    exit 1
  fi
  TARGET="^$latest_version"
fi

pnpm pkg set "dependencies.@cobuild/wire=$TARGET"
pnpm install --force

echo "Switched @cobuild/wire to $TARGET"
