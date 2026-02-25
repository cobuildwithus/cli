# buildbot

TypeScript CLI + Codex skill for running wallet actions through the interface app's `buildbot` API.

> Warning
> This project drives real wallet operations. Use test networks and small amounts while validating your setup.

## What You Get

- `buildbot` CLI for `setup`, `wallet`, `send`, and `tx`
- `buildbot docs` command for Cobuild documentation search via API
- Installable Codex skill package at `skills/buildbot-cli`
- JSON-first command output for automation

## Requirements

- Node.js 20+
- pnpm
- Running interface app URL (for example `http://localhost:3000`)

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
npx @cobuildwithus/buildbot --help
```

## Quick Start (CLI)

```bash
# 1) Configure and bootstrap wallet access
pnpm start -- setup --url http://localhost:3000 --chat-api-url http://localhost:4000 --network base-sepolia --agent default
# or: pnpm start -- setup --dev --network base-sepolia --agent default

# 2) Verify config (token is masked)
pnpm start -- config show

# 3) Check wallet
pnpm start -- wallet --network base-sepolia --agent default
```

If `buildbot` is on your PATH, you can drop `pnpm start --` and run `buildbot <command>` directly.

## Agent Skill Setup (Codex)

This is the fastest path for people who want to use the agent skill.

### Option A: Install from local checkout

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/buildbot-cli "${CODEX_HOME:-$HOME/.codex}/skills/buildbot-cli"
```

### Option B: Install from GitHub

```bash
install-skill-from-github.py --repo <owner>/<repo> --path skills/buildbot-cli
```

### Verify + use

1. Restart Codex after installing the skill.
2. Confirm the skill folder exists at `${CODEX_HOME:-$HOME/.codex}/skills/buildbot-cli`.
3. Invoke with prompts like: `Use $buildbot-cli to run wallet on base-sepolia`.

## Setup Details

`setup` supports secure browser approval and non-interactive token sources.
It defaults to:
- interface URL: `https://co.build` (or `http://localhost:3000` with `--dev`)
- chat API URL: `https://chat-api.co.build` (or `http://localhost:4000` with `--dev`)

```bash
buildbot setup [--url <interface-url>] [--chat-api-url <chat-api-url>] [--dev] [--token <pat>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--json] [--link]
```

- Browser approval flow:
  - Opens `/home` in your interface app and waits for one-time localhost callback approval.
  - Falls back to hidden manual token prompt only if approval fails or times out.
- Machine output:
  - Use `--json` or `BUILD_BOT_OUTPUT=json`.
- Global command install:
  - Use `--link` during setup to run `pnpm link --global` automatically when possible.

## Command Reference

```bash
buildbot wallet [--network <network>] [--agent <key>]
buildbot docs <query> [--limit <n>]
buildbot send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <uuid-v4>]
buildbot tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <uuid-v4>]
```

Examples:

```bash
buildbot wallet --network base-sepolia --agent default
buildbot docs setup approval flow --limit 5
buildbot docs -- --token-stdin
buildbot send usdc 0.10 0x000000000000000000000000000000000000dEaD --network base-sepolia --agent default
buildbot tx --to 0x000000000000000000000000000000000000dEaD --data 0x --value 0 --network base-sepolia --agent default
```

If your query starts with a dash (for example, `--token-stdin`), insert `--` before the query so the CLI treats it as text, not flags.

`send` and `tx` always include both `X-Idempotency-Key` and `Idempotency-Key` headers.

## Troubleshooting

- `buildbot: command not found`
  - Run via `pnpm start -- <command>` from this repo, or run setup with `--link`.
- Setup succeeds but wallet bootstrap fails
  - Check interface logs, apply Build Bot SQL migrations, and verify `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET`.
- Wrong URL/network
  - Re-run setup with explicit `--url`, `--chat-api-url`, and `--network`.

## Developer Commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm verify
pnpm docs:drift
pnpm docs:gardening
pnpm review:gpt
```

## Architecture + Process Docs

- `AGENTS.md`: routing rules and mandatory workflow
- `ARCHITECTURE.md`: system-level design
- `agent-docs/index.md`: canonical docs map
