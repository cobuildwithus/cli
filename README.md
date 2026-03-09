# cli

TypeScript CLI + agent skill for running wallet actions through the interface app's API (`/api/cli/*` routes).

> Warning
> This project drives real wallet operations. Use test networks and small amounts while validating your setup.

## What You Get

- `cli` CLI for `setup`, `wallet`, `send`, and `tx`
- `cli docs` command for Cobuild documentation search via API
- Installable agent skill package at `skills/cli`
- JSON-first command output for automation

## Requirements

- Node.js 20+
- pnpm
- Running interface app URL (for example `http://localhost:3000`)
- `/v1/*` routing from that URL to Chat API (`/v1/tools` and `/v1/tool-executions`) when self-hosted

## Install CLI

From this repo:

```bash
pnpm install
pnpm build
```

Run locally from the repo:

```bash
pnpm start -- --help
```

Run from npm (published package):

```bash
npx @cobuild/cli --help
```

## Quick Start (CLI)

```bash
# 1) Configure and bootstrap wallet access
pnpm start -- setup --url http://localhost:3000 --network base-sepolia --agent default
# or: pnpm start -- setup --dev --network base-sepolia --agent default

# 2) Verify config (token is masked)
pnpm start -- config show

# 3) Check wallet
pnpm start -- wallet --network base-sepolia --agent default
```

If `cli` is on your PATH, you can drop `pnpm start --` and run `cli <command>` directly.

## Agent Skill Setup

This is the fastest path for people who want to use the agent skill.

### Option A: Install from local checkout

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/cli "${CODEX_HOME:-$HOME/.codex}/skills/cli"
```

### Option B: Install from GitHub

```bash
install-skill-from-github.py --repo <owner>/<repo> --path skills/cli
```

### Verify + use

1. Restart Codex after installing the skill.
2. Confirm the skill folder exists at `${CODEX_HOME:-$HOME/.codex}/skills/cli`.
3. Invoke with prompts like: `Use $cli to run wallet on base-sepolia`.

## Setup Details

`setup` supports secure browser approval and non-interactive token sources.
It defaults to:
- interface URL: `https://co.build` (or `http://localhost:3000` with `--dev`)

```bash
cli setup [--url <interface-url>] [--chat-api-url <chat-api-url>] [--dev] [--token <pat>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--payer-mode hosted|local-generate|local-key|skip] [--payer-private-key-stdin|--payer-private-key-file <path>] [--json] [--link]
```

- Browser approval flow:
  - Opens `/home` in your interface app and waits for one-time localhost callback approval.
  - Falls back to hidden manual token prompt only if approval fails or times out.
- Optional wallet payer setup (same setup command):
  - `--payer-mode hosted` uses backend wallet access for paid requests.
  - `--payer-mode local-generate` creates and stores a local payer key.
  - `--payer-mode local-key` uses `--payer-private-key-stdin` or `--payer-private-key-file`.
- Machine output:
  - Command result payloads are emitted on stdout as JSON.
  - Setup wizard/progress/prompts are emitted on stderr so stdout remains parseable.
  - `setup --json` or `COBUILD_CLI_OUTPUT=json` disables interactive wizard behavior.
- Global command install:
  - Use `--link` during setup to run `pnpm link --global` automatically when possible.

## Config Resolution Order

For `setup`, values resolve in this order:

1. Interface URL: `--url` -> saved config URL -> `COBUILD_CLI_URL` -> default (`https://co.build`, or `http://localhost:3000` with `--dev`).
2. Network: `--network` -> `COBUILD_CLI_NETWORK` -> `base-sepolia`.
3. Token: exactly one of `--token`/`--token-file`/`--token-stdin` -> saved secret ref in config (`auth.tokenRef`) -> interactive browser approval/manual prompt.

For runtime commands:

- Agent key: `--agent` -> saved config `agent` -> `default`.
- Exec network (`send`/`tx`): `--network` -> `COBUILD_CLI_NETWORK` -> `base-sepolia`.

## `/v1` Route Ownership

- `docs` and `tools` use canonical tool routes: `GET /v1/tools` and `POST /v1/tool-executions`.
- CLI still uses one configured base URL (`url` in config).
- For hosted `https://co.build`, edge routing handles `/v1/*` to Chat API.
- For self-hosting, configure your gateway/reverse-proxy to route `/v1/*` to Chat API.

## Output Contract

- `setup`, `wallet`, `docs`, `tools`, `send`, and `tx` emit JSON on success.
- `setup` keeps human wizard/progress text on stderr so stdout remains machine-readable.
- Failures exit non-zero and print human-readable diagnostics.

## Agent-Friendly Globals

The CLI now ships with newer Incur built-ins that are useful for both agents and humans:

```bash
# Compact command index for quick agent discovery
cli --llms

# Full manifest with schemas/examples
cli --llms-full --format json

# Raw JSON Schema for one command
cli wallet --schema --format json

# Cobuild-specific schema wrapper with metadata
cli schema wallet

# Trim large payloads to the fields you care about
cli docs setup approval flow --filter-output results[0,2].title

# Token-aware pagination for large responses
cli docs setup approval flow --token-count
cli docs setup approval flow --token-limit 120 --token-offset 120

# Generate shell completions
cli completions zsh
```

## Command Auth Requirements

- No pre-existing token needed: `setup`, `config set`, `config show`, and `--help`.
- Requires saved interface URL + resolvable PAT secret ref: `wallet`, `docs`, `tools`, `send`, `tx`.
- Usually requires funded wallet: `send`, and most state-changing `tx` calls.

## Command Reference

```bash
cli wallet [--network <network>] [--agent <key>]
cli wallet payer init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]
cli wallet payer status [--agent <key>]
cli docs <query> [--limit <n>]
cli send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <uuid-v4>]
cli tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <uuid-v4>]
```

Examples:

```bash
cli wallet --network base-sepolia --agent default
cli wallet payer init --agent default --mode local-generate
cli wallet payer status --agent default
cli docs setup approval flow --limit 5
cli docs -- --token-stdin
cli send usdc 0.10 0x000000000000000000000000000000000000dEaD --network base-sepolia --agent default
cli tx --to 0x000000000000000000000000000000000000dEaD --data 0x --value 0 --network base-sepolia --agent default
```

If your query starts with a dash (for example, `--token-stdin`), insert `--` before the query so the CLI treats it as text, not flags.

`send` and `tx` send canonical `Idempotency-Key` and keep `X-Idempotency-Key` as a deprecated compatibility fallback.

## Troubleshooting

- `cli: command not found`
  - Run via `pnpm start -- <command>` from this repo, or run setup with `--link`.
- Setup succeeds but wallet bootstrap fails
  - Check interface logs, apply CLI SQL migrations, and verify `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET`.
- `Canonical /v1 tool routes are unavailable`
  - Configure routing so `/v1/tools` and `/v1/tool-executions` resolve to Chat API from your configured CLI base URL.
- Wrong URL/network
  - Re-run setup with explicit `--url` and `--network`.

## Developer Commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm verify  # typecheck + coverage-inclusive test run
pnpm docs:drift
pnpm docs:gardening
pnpm review:gpt
```

## Release Flow (npm)

Release ownership note: release/version-bump/publish actions are user-operated by default. Agents should not run release flows unless explicitly instructed in the current chat turn.

Run release checks first:

```bash
pnpm run release:check
```

Create and push a release tag (which triggers `.github/workflows/release.yml` to publish):

```bash
pnpm release:patch   # or: pnpm release:minor / pnpm release:major
```

For pre-releases:

```bash
bash scripts/release.sh preminor --preid alpha
# or: bash scripts/release.sh preminor --preid beta
```

For exact version and dry-run:

```bash
bash scripts/release.sh 1.2.3-rc.1 --dry-run
```

What the release script does:
- requires a clean git worktree
- requires the current branch to be `main` (override only with `--allow-non-main`)
- requires `origin` remote, package name `@cobuild/cli`, and `package.json.repository.url` = `https://github.com/cobuildwithus/cli`
- runs `pnpm verify` (typecheck + coverage-inclusive test run), `pnpm docs:drift`, `pnpm docs:gardening`, `pnpm build`, and `npm pack --dry-run`
- bumps version with `npm version --no-git-tag-version`
- updates `CHANGELOG.md`
- generates Codex-style release notes at `release-notes/v<version>.md`
- creates release commit + `v*` tag
- validates tag/version match
- pushes commit + tags so GitHub Actions can publish to npm

CI release workflow (`.github/workflows/release.yml`) does:
- tag/version validation against `package.json` including package identity + canonical repository metadata
- docs drift + doc gardening gates before packaging
- tarball build as an artifact before publish
- GitHub Release creation from `release-notes/v<version>.md` (fallback: generated on CI)
- npm Trusted Publishing via OIDC with prerelease dist-tag routing and idempotent publish handling

Changelog + release notes helpers:

```bash
pnpm run changelog:update -- 0.2.0
pnpm run release:notes -- 0.2.0 /tmp/release-notes.md
```

## Architecture + Process Docs

- `AGENTS.md`: routing rules and mandatory workflow
- `ARCHITECTURE.md`: system-level design
- `agent-docs/index.md`: canonical docs map
