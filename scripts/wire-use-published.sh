#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: pnpm wire:use-published <version-or-tag>"
  echo "Example: pnpm wire:use-published ^0.1.0"
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TARGET="$1"

cd "$REPO_ROOT"

pnpm pkg set "dependencies.@cobuild/wire=$TARGET"
pnpm install --force

echo "Switched @cobuild/wire to $TARGET"
