# build-bot

Standalone CLI for wallet actions via the interface app's `build-bot` API.

## Requirements

- Node.js 20+
- pnpm

## Install

```bash
pnpm install
pnpm build
```

Published usage (after npm release):

```bash
npx @cobuildwithus/build-bot setup
```

## Codex Skill Package

This repo ships an installable skill package at `skills/build-bot-cli`.

Install from a local checkout:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/build-bot-cli "${CODEX_HOME:-$HOME/.codex}/skills/build-bot-cli"
```

Install from GitHub with your skill installer (replace owner/repo):

```bash
install-skill-from-github.py --repo <owner>/<repo> --path skills/build-bot-cli
```

Restart Codex after installing a skill.

## Configure

```bash
pnpm start -- setup --url http://localhost:3000 --network base-sepolia
```

`setup` runs an interactive wizard, opens `/home` in your interface app, and waits for secure browser approval that sends a one-time PAT to the CLI over a localhost callback channel.
If browser approval fails or times out, setup falls back to hidden manual token entry.
Use `--json` (or `BUILD_BOT_OUTPUT=json`) for machine-readable setup output.
Use `--link` to automatically run `pnpm link --global` after successful setup (when run from the local repo root).

Inspect saved config (token is masked):

```bash
pnpm start -- config show
```

## Commands

```bash
pnpm start -- wallet --network base-sepolia --agent default
pnpm start -- send usdc 0.10 0x000000000000000000000000000000000000dEaD --network base-sepolia --agent default
pnpm start -- tx --to 0x000000000000000000000000000000000000dEaD --data 0x --value 0 --network base-sepolia --agent default
```

If `buildbot` is not on your shell `PATH`, run commands as `pnpm start -- <command>`.

`send` and `tx` automatically include both `X-Idempotency-Key` and `Idempotency-Key`. Use `--idempotency-key <uuid-v4>` to provide your own key for retry-safe reruns.

## Architecture and Agent Docs

- `AGENTS.md`: agent routing rules and required workflow.
- `ARCHITECTURE.md`: system-level CLI architecture map.
- `agent-docs/index.md`: canonical map for durable docs.

## Common Scripts

```bash
pnpm build            # Compile TypeScript CLI into dist/
pnpm typecheck        # Static type checking
pnpm test             # Vitest suite (no coverage)
pnpm test:coverage    # Vitest suite with per-file coverage gates
pnpm verify           # typecheck + test + coverage gates
pnpm release:patch    # bump patch, verify/build, publish, push tags
pnpm release:minor    # bump minor, verify/build, publish, push tags
pnpm release:major    # bump major, verify/build, publish, push tags
pnpm docs:drift       # enforce docs/process coupling rules
pnpm docs:gardening   # enforce docs index/inventory consistency
pnpm review:gpt       # package repo snapshot and open ChatGPT via Oracle browser mode
```

## ChatGPT Review Launcher

Run:

```bash
pnpm -s review:gpt
```

Useful variants:

```bash
# run a focused preset
pnpm -s review:gpt --preset security

# shorthand positional preset
pnpm -s review:gpt reliability

# combine multiple presets
pnpm -s review:gpt --preset security,cli-contracts,test-gaps

# preview command without launching
pnpm -s review:gpt --dry-run

# pass Oracle flags through after --
pnpm -s review:gpt test-gaps -- --debug
```

Presets live in `scripts/chatgpt-review-presets/`.

## Plan and Commit Helpers

```bash
bash scripts/open-exec-plan.sh <slug> "<title>"
bash scripts/close-exec-plan.sh agent-docs/exec-plans/active/<file>.md
scripts/committer "docs(cli): summary" path/to/file1 path/to/file2
```
