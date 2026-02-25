#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/release.sh check
  bash scripts/release.sh <patch|minor|major|prepatch|preminor|premajor|prerelease|x.y.z[-channel.n]> [--preid <alpha|beta|rc>] [--dry-run] [--no-push] [--allow-non-main]

Examples:
  bash scripts/release.sh patch
  bash scripts/release.sh preminor --preid alpha
  bash scripts/release.sh 1.2.3-rc.1 --dry-run
  bash scripts/release.sh check
EOF
}

ACTION="${1:-}"
if [ -z "$ACTION" ]; then
  usage >&2
  exit 1
fi
shift

PREID=""
DRY_RUN=false
PUSH_TAGS=true
ALLOW_NON_MAIN=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --preid)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --preid"
        usage
        exit 2
      fi
      PREID="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      PUSH_TAGS=false
      shift
      ;;
    --no-push)
      PUSH_TAGS=false
      shift
      ;;
    --allow-non-main)
      ALLOW_NON_MAIN=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

assert_clean_worktree() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "Error: git working tree must be clean before release." >&2
    exit 1
  fi
}

assert_main_branch() {
  if [ "$ALLOW_NON_MAIN" = true ]; then
    return
  fi

  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$current_branch" != "main" ]; then
    echo "Error: releases must run from main (current: $current_branch)." >&2
    exit 1
  fi
}

assert_origin_remote() {
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Error: git remote 'origin' is not configured." >&2
    exit 1
  fi
}

assert_package_name() {
  package_name="$(node -p "require('./package.json').name")"
  if [ "$package_name" != "@cobuild/cli" ]; then
    echo "Error: unexpected package name '$package_name' (expected @cobuild/cli)." >&2
    exit 1
  fi
}

run_release_checks() {
  echo "Running release checks..."
  pnpm install --frozen-lockfile

  echo "==> Running verify"
  pnpm verify

  echo "==> Building"
  pnpm build

  echo "==> Validating release scripts"
  bash -n scripts/release.sh scripts/update-changelog.sh scripts/generate-release-notes.sh

  echo "==> Validating npm package contents"
  npm pack --dry-run >/dev/null
}

is_exact_version() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]
}

resolve_npm_tag() {
  local version="$1"
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo ""
    return 0
  fi
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-(alpha|beta|rc)\.[0-9]+$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi

  echo "Unsupported release version format: $version" >&2
  echo "Expected x.y.z or x.y.z-(alpha|beta|rc).n" >&2
  exit 1
}

if [ "$ACTION" = "check" ]; then
  assert_package_name
  run_release_checks
  echo "Release checks passed."
  exit 0
fi

case "$ACTION" in
  patch|minor|major|prepatch|preminor|premajor|prerelease)
    ;;
  *)
    if ! is_exact_version "$ACTION"; then
      echo "Error: unsupported release action or version '$ACTION'." >&2
      usage >&2
      exit 2
    fi
    ;;
  esac

if [ -n "$PREID" ]; then
  if ! [[ "$PREID" =~ ^(alpha|beta|rc)$ ]]; then
    echo "Error: --preid must be one of alpha|beta|rc." >&2
    exit 2
  fi

  case "$ACTION" in
    prepatch|preminor|premajor|prerelease)
      ;;
    *)
      echo "Error: --preid is only valid with prepatch/preminor/premajor/prerelease." >&2
      exit 2
      ;;
  esac
fi

case "$ACTION" in
  prepatch|preminor|premajor|prerelease)
    if [ -z "$PREID" ]; then
      echo "Error: --preid is required with prepatch/preminor/premajor/prerelease." >&2
      exit 2
    fi
    ;;
esac

assert_clean_worktree
assert_main_branch
assert_origin_remote
assert_package_name

run_release_checks

current_version="$(node -p "require('./package.json').version")"
echo "Current version: $current_version"

npm_version_args=("$ACTION" "--no-git-tag-version")
if [ -n "$PREID" ]; then
  npm_version_args+=("--preid" "$PREID")
fi

new_tag="$(npm version "${npm_version_args[@]}" | tail -n1 | tr -d '\r')"
new_version="${new_tag#v}"
npm_dist_tag="$(resolve_npm_tag "$new_version")"

if [ -n "$npm_dist_tag" ]; then
  echo "Release channel: $npm_dist_tag"
else
  echo "Release channel: latest"
fi

if [ "$DRY_RUN" = true ]; then
  git restore --worktree --staged package.json >/dev/null 2>&1 || true
  echo "Dry run only."
  echo "Would prepare release: @cobuild/cli@$new_version"
  echo "Would create tag: v$new_version"
  exit 0
fi

previous_tag="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"

echo "==> Updating changelog"
"$SCRIPT_DIR/update-changelog.sh" "$new_version"

release_notes_path="release-notes/v${new_version}.md"
echo "==> Generating release notes at $release_notes_path"
if [ -n "$previous_tag" ]; then
  "$SCRIPT_DIR/generate-release-notes.sh" "$new_version" "$release_notes_path" --from-tag "$previous_tag" --to-ref HEAD
else
  "$SCRIPT_DIR/generate-release-notes.sh" "$new_version" "$release_notes_path" --to-ref HEAD
fi

echo "==> Creating release commit/tag"
git add package.json CHANGELOG.md "$release_notes_path"
git commit -m "chore(release): v${new_version}"
git tag -a "v${new_version}" -m "chore(release): v${new_version}"

if [ "$PUSH_TAGS" = true ]; then
  echo "==> Pushing release commit and tags"
  git push --follow-tags
  echo "Pushed v${new_version}. GitHub Actions will publish this release to npm."
else
  echo "Skipped push (--no-push). Push with: git push --follow-tags"
fi
