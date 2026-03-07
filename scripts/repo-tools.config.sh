#!/usr/bin/env bash
set -euo pipefail

COBUILD_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

consumer_shell_path=""
for candidate in \
  "$COBUILD_REPO_ROOT/node_modules/@cobuild/repo-tools/src/consumer-shell.sh" \
  "$COBUILD_REPO_ROOT/../repo-tools/src/consumer-shell.sh"
do
  if [ -f "$candidate" ]; then
    consumer_shell_path="$candidate"
    break
  fi
done

if [ -n "$consumer_shell_path" ]; then
  # shellcheck source=/dev/null
  source "$consumer_shell_path"
else
  repo_tools_join_lines() {
    local out_var="$1"
    shift
    local joined=""
    local item
    for item in "$@"; do
      joined+="${item}"$'\n'
    done
    printf -v "$out_var" '%s' "$joined"
    export "$out_var"
  }

  cobuild_repo_tool_path() {
    local relative_path="$1"
    local local_path="$COBUILD_REPO_ROOT/node_modules/@cobuild/repo-tools/$relative_path"
    local sibling_path="$COBUILD_REPO_ROOT/../repo-tools/$relative_path"

    if [ -f "$local_path" ]; then
      printf '%s\n' "$local_path"
      return 0
    fi

    if [ -f "$sibling_path" ]; then
      printf '%s\n' "$sibling_path"
      return 0
    fi

    echo "Error: missing repo-tools file '$relative_path'. Install dependencies first." >&2
    return 1
  }

  cobuild_repo_tool_bin() {
    local bin_name="$1"
    local local_bin="$COBUILD_REPO_ROOT/node_modules/.bin/$bin_name"
    local sibling_bin="$COBUILD_REPO_ROOT/../repo-tools/bin/$bin_name"

    if [ -x "$local_bin" ]; then
      printf '%s\n' "$local_bin"
      return 0
    fi

    if [ -x "$sibling_bin" ]; then
      printf '%s\n' "$sibling_bin"
      return 0
    fi

    if command -v "$bin_name" >/dev/null 2>&1; then
      command -v "$bin_name"
      return 0
    fi

    echo "Error: missing repo-tools executable '$bin_name'. Install dependencies first." >&2
    return 1
  }
fi

required_files=(
  "agent-docs/index.md"
  "ARCHITECTURE.md"
  "AGENTS.md"
  "agent-docs/PLANS.md"
  "agent-docs/RELIABILITY.md"
  "agent-docs/SECURITY.md"
  "agent-docs/QUALITY_SCORE.md"
  "agent-docs/cli-architecture.md"
  "agent-docs/prompts/simplify.md"
  "agent-docs/prompts/test-coverage-audit.md"
  "agent-docs/prompts/task-finish-review.md"
  "agent-docs/references/README.md"
  "agent-docs/references/module-boundary-map.md"
  "agent-docs/references/cli-command-and-data-flow.md"
  "agent-docs/references/testing-ci-map.md"
  "agent-docs/generated/README.md"
  "agent-docs/generated/doc-inventory.md"
  "agent-docs/generated/doc-gardening-report.md"
  "agent-docs/exec-plans/active/README.md"
  "agent-docs/exec-plans/completed/README.md"
  "agent-docs/exec-plans/tech-debt-tracker.md"
)
repo_tools_join_lines COBUILD_DRIFT_REQUIRED_FILES "${required_files[@]}"
export COBUILD_DRIFT_CODE_CHANGE_PATTERN='^(src/|scripts/|package\\.json$|README\\.md$|ARCHITECTURE\\.md$|AGENTS\\.md$)'
export COBUILD_DRIFT_CODE_CHANGE_LABEL='Architecture-sensitive code/process'
export COBUILD_DRIFT_LARGE_CHANGE_THRESHOLD='10'
export COBUILD_DRIFT_CHANGED_COUNT_EXCLUDE_PATTERN='^agent-docs/generated/|^agent-docs/exec-plans/(active|completed)/|^pnpm-lock\\.yaml$'
export COBUILD_DRIFT_ALLOW_RELEASE_ARTIFACTS_ONLY='1'
export COBUILD_COMMITTER_EXAMPLE='fix(cli): normalize api errors'
export COBUILD_DOC_GARDENING_EXTRA_TRACKED_PATHS=ARCHITECTURE.md$'\n'
export COBUILD_AUDIT_CONTEXT_PREFIX='cobuild-cli-audit'
export COBUILD_AUDIT_CONTEXT_TITLE='Cobuild CLI Audit Bundle'
export COBUILD_AUDIT_CONTEXT_REPO_LABEL='cli'
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS \
  "AGENTS.md" \
  "ARCHITECTURE.md" \
  "README.md" \
  "package.json" \
  "pnpm-lock.yaml" \
  "tsconfig.json" \
  "tsconfig.build.json" \
  "vitest.config.ts"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
  "src" \
  "scripts"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_TEST_SCAN_SPECS \
  "tests" \
  "test"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_DOC_SCAN_SPECS \
  "agent-docs:*.md"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_CI_SCAN_SPECS \
  ".github/workflows"
export COBUILD_RELEASE_PACKAGE_NAME='@cobuild/cli'
export COBUILD_RELEASE_REPOSITORY_URL='https://github.com/cobuildwithus/cli'
export COBUILD_RELEASE_NOTES_ENABLED='1'
export COBUILD_RELEASE_COMMIT_TEMPLATE='chore(release): v%s'
export COBUILD_RELEASE_TAG_MESSAGE_TEMPLATE='chore(release): v%s'
