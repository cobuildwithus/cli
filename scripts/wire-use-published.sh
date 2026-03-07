#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec pnpm exec cobuild-switch-package-source --package @cobuild/wire --field dependencies --published "$@"
