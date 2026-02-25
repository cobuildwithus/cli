#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/release.sh check
  bash scripts/release.sh <patch|minor|major|prepatch|preminor|premajor|prerelease> [--preid <alpha|beta|rc>] [--no-push] [--allow-non-main]

Examples:
  bash scripts/release.sh patch
  bash scripts/release.sh preminor --preid alpha
  bash scripts/release.sh check
EOF
}

ACTION="${1:-patch}"
shift || true

PREID=""
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

assert_clean_worktree() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is dirty. Commit or stash changes before releasing."
    exit 1
  fi
}

assert_main_branch() {
  if [ "$ALLOW_NON_MAIN" = true ]; then
    return
  fi

  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$current_branch" != "main" ]; then
    echo "Releases must run from main. Current branch: $current_branch"
    echo "Use --allow-non-main only if you intentionally need a different branch."
    exit 1
  fi
}

run_release_checks() {
  echo "==> Installing dependencies"
  pnpm install --frozen-lockfile

  echo "==> Running verification checks"
  pnpm verify

  echo "==> Building dist artifacts"
  pnpm build

  echo "==> Validating npm package contents"
  npm pack --dry-run >/dev/null
}

resolve_npm_tag() {
  local version="$1"
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo ""
    return 0
  fi
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+$ ]]; then
    echo "alpha"
    return 0
  fi
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]; then
    echo "beta"
    return 0
  fi
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]]; then
    echo "rc"
    return 0
  fi

  echo "Unsupported release version format: $version"
  echo "Expected x.y.z or x.y.z-(alpha|beta|rc).n"
  exit 1
}

if [ "$ACTION" = "check" ]; then
  run_release_checks
  echo "Release checks passed."
  exit 0
fi

case "$ACTION" in
  patch|minor|major|prepatch|preminor|premajor|prerelease)
    ;;
  *)
    echo "Unsupported release action: $ACTION"
    usage
    exit 2
    ;;
esac

assert_clean_worktree
assert_main_branch

run_release_checks

npm_version_args=("$ACTION" "-m" "chore(release): %s")
if [ -n "$PREID" ]; then
  npm_version_args+=("--preid" "$PREID")
fi

echo "==> Bumping version and creating release commit/tag"
new_tag="$(npm version "${npm_version_args[@]}" | tail -n1 | tr -d '\r')"
if [[ ! "$new_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "npm version returned unexpected tag: $new_tag"
  exit 1
fi

package_version="$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version)")"
tag_version="${new_tag#v}"

if [ "$package_version" != "$tag_version" ]; then
  echo "Tag/version mismatch: tag=$new_tag package.json=$package_version"
  exit 1
fi

npm_dist_tag="$(resolve_npm_tag "$tag_version")"
if [ -n "$npm_dist_tag" ]; then
  echo "Release tag: $new_tag (npm dist-tag: $npm_dist_tag)"
else
  echo "Release tag: $new_tag (npm dist-tag: latest)"
fi

if [ "$PUSH_TAGS" = true ]; then
  echo "==> Pushing release commit and tags"
  git push --follow-tags
  echo "Pushed $new_tag. GitHub Actions will publish this release to npm."
else
  echo "Skipped push (--no-push). Push with: git push --follow-tags"
fi
