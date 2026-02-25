#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-patch}" # patch|minor|major

if ! git diff --quiet; then
  echo "Working tree is dirty. Commit or stash changes before releasing."
  exit 1
fi

pnpm install --frozen-lockfile
pnpm verify
pnpm build

npm version "$BUMP" -m "chore(release): %s"
npm publish --access public

git push --follow-tags
