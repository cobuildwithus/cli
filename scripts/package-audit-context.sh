#!/usr/bin/env bash

set -euo pipefail

format="both"
out_dir=""
prefix="cobuild-build-bot-audit"
include_tests=1
include_docs=1
include_ci=1

usage() {
  cat <<'EOF'
Usage: scripts/package-audit-context.sh [options]

Packages audit-relevant build-bot files into upload-friendly artifacts.

Options:
  --zip              Create only a .zip archive
  --txt              Create only a merged .txt file
  --both             Create both .zip and .txt (default)
  --out-dir <dir>    Output directory (default: <repo>/audit-packages)
  --name <prefix>    Output filename prefix (default: cobuild-build-bot-audit)
  --with-tests       Include tests/** and test/** (included by default)
  --no-tests         Exclude tests/** and test/**
  --no-docs          Exclude agent-docs/**/*.md
  --no-ci            Exclude .github/workflows/**
  -h, --help         Show this help message
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --zip)
      format="zip"
      shift
      ;;
    --txt)
      format="txt"
      shift
      ;;
    --both)
      format="both"
      shift
      ;;
    --out-dir)
      if [ "$#" -lt 2 ]; then
        echo "Error: --out-dir requires a value." >&2
        exit 1
      fi
      out_dir="$2"
      shift 2
      ;;
    --name)
      if [ "$#" -lt 2 ]; then
        echo "Error: --name requires a value." >&2
        exit 1
      fi
      prefix="$2"
      shift 2
      ;;
    --with-tests)
      include_tests=1
      shift
      ;;
    --no-tests)
      include_tests=0
      shift
      ;;
    --no-docs)
      include_docs=0
      shift
      ;;
    --no-ci)
      include_ci=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'." >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "Error: not inside a git repository." >&2
  exit 1
fi

if [ -z "$out_dir" ]; then
  out_dir="$ROOT/audit-packages"
fi

mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

if [ "$format" = "zip" ] || [ "$format" = "both" ]; then
  if ! command -v zip >/dev/null 2>&1; then
    echo "Error: zip is required for --zip/--both modes." >&2
    exit 1
  fi
fi

timestamp="$(date -u '+%Y%m%d-%H%M%SZ')"
base_name="${prefix}-${timestamp}"

manifest="$(mktemp)"
cleanup() {
  rm -f "$manifest"
}
trap cleanup EXIT

list_tree_files() {
  local rel_dir="$1"

  if [ ! -d "$ROOT/$rel_dir" ]; then
    return 0
  fi

  find "$ROOT/$rel_dir" -type f -print | sed "s#^$ROOT/##"
}

{
  for relpath in \
    AGENTS.md \
    ARCHITECTURE.md \
    README.md \
    package.json \
    pnpm-lock.yaml \
    tsconfig.json \
    tsconfig.build.json \
    vitest.config.ts; do
    if [ -f "$ROOT/$relpath" ]; then
      echo "$relpath"
    fi
  done

  list_tree_files src
  list_tree_files scripts

  if [ "$include_tests" -eq 1 ]; then
    list_tree_files tests
    list_tree_files test
  fi

  if [ "$include_docs" -eq 1 ]; then
    list_tree_files agent-docs
  fi

  if [ "$include_ci" -eq 1 ]; then
    list_tree_files .github/workflows
  fi
} | awk 'NF' | sort -u | while IFS= read -r relpath; do
  if [ -f "$ROOT/$relpath" ]; then
    echo "$relpath"
  else
    echo "Warning: skipping missing selected file: $relpath" >&2
  fi
done >"$manifest"

file_count="$(wc -l < "$manifest" | tr -d ' ')"
if [ "$file_count" = "0" ]; then
  echo "Error: no files matched packaging filters." >&2
  exit 1
fi

zip_path=""
txt_path=""

if [ "$format" = "zip" ] || [ "$format" = "both" ]; then
  zip_path="$out_dir/$base_name.zip"
  (
    cd "$ROOT"
    zip -q "$zip_path" -@ <"$manifest"
  )
fi

if [ "$format" = "txt" ] || [ "$format" = "both" ]; then
  txt_path="$out_dir/$base_name.txt"
  {
    echo "# Cobuild Build Bot Audit Bundle"
    echo "# Generated (UTC): $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "# Repository: $ROOT"
    echo "# Files: $file_count"

    while IFS= read -r relpath; do
      printf '\n===== FILE: %s =====\n' "$relpath"
      cat -- "$ROOT/$relpath"
      printf '\n'
    done <"$manifest"
  } >"$txt_path"
fi

echo "Audit package created."
echo "Included files: $file_count"

if [ -n "$zip_path" ]; then
  echo "ZIP: $zip_path ($(du -h "$zip_path" | awk '{print $1}'))"
fi

if [ -n "$txt_path" ]; then
  echo "TXT: $txt_path ($(du -h "$txt_path" | awk '{print $1}'))"
fi
