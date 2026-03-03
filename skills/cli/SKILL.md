---
name: cli
description: Configure and operate the CLI for setup, wallet bootstrap, docs/tool lookups, send, and tx commands. Use when users ask to run cli commands, complete setup with browser approval, inspect wallet details, query docs/tool routes, or automate CLI output in JSON mode.
---

# CLI

Use this skill when the task should run through the `cli` CLI instead of calling interface APIs directly.

## Canonical Entrypoint

Use a single invocation style:

```bash
cli <command>
```

If `cli` is not on `PATH` and you are working from this repository checkout, use:

```bash
pnpm start -- <command>
```

## Incur Runtime Surfaces

The CLI is backed by Incur command routing and includes built-in discovery commands:

```bash
cli --help
cli --llms
cli skills add
cli mcp add
```

## Setup Flow

Run:

```bash
cli setup --url <interface-url> --network <network> --agent <agent>
```

For deterministic agent automation, run setup in machine mode:

```bash
cli setup --url <interface-url> --network <network> --agent <agent> --json
```

`--json` can also be placed before the command (`cli --json setup ...`) and is remapped to setup machine mode.
`--json` can also be enabled with `COBUILD_CLI_OUTPUT=json`.

For local developer installs, add `--link` to setup to run `pnpm link --global` and make `cli` available on PATH:

```bash
cli setup --url <interface-url> --network <network> --agent <agent> --link
```

## Resolution Rules

`setup` value precedence:

- URL: `--url` -> saved config URL -> `COBUILD_CLI_URL` -> default (`https://co.build`, or `http://localhost:3000` with `--dev`).
- Network: `--network` -> `COBUILD_CLI_NETWORK` -> `base-sepolia`.
- Token: exactly one of `--token|--token-file|--token-stdin` -> saved config token -> interactive browser/manual flow.

Runtime precedence:

- Agent key: `--agent` -> saved config `agent` -> `default`.
- `send`/`tx` network: `--network` -> `COBUILD_CLI_NETWORK` -> `base-sepolia`.

## Core Commands

```bash
cli wallet --network <network> --agent <agent>
cli docs <query> [--limit <n>]
cli tools get-user <fname>
cli tools get-cast <identifier> [--type <hash|url>]
cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
cli tools get-treasury-stats
cli send usdc <amount> <to> --network <network> --agent <agent>
cli tx --to <address> --data <hex> --value <eth> --network <network> --agent <agent>
```

Group command notes:

- `cli tools` and `cli farcaster` print group help (no-op success) when no subcommand is provided.
- Unknown subcommands still fail non-zero with explicit error messages.

## Command Routing

- `docs` calls canonical tool execution (`POST /v1/tool-executions`, optional `GET /v1/tools` discovery).
- `tools get-user|get-cast|cast-preview|get-treasury-stats` call canonical tool execution (`POST /v1/tool-executions`, optional `GET /v1/tools` discovery).
- `wallet`, `send`, and `tx` call interface API `POST /api/buildbot/wallet` and `POST /api/buildbot/exec`.
- Hosted `https://co.build` routes `/v1/*` to Chat API at the edge; self-hosted installs must configure `/v1/*` routing to Chat API explicitly.

## Output Contract

- `setup --json` returns an object with `config`, `defaultNetwork`, `wallet`, and `next`.
- `setup --json` remains setup-scoped machine mode (not the global Incur output-format switch).
- `config set` returns JSON (`{ ok: true, path }`) on success.
- `wallet`, `docs`, `tools`, `send`, and `tx` print JSON on success.
- Command failures exit non-zero with human-readable diagnostics.
- `setup` is intentionally unavailable when running the CLI as an MCP server (`--mcp`).

## Auth and Funds Expectations

- No pre-existing token required: `setup`, `config set`, and `config show`.
- Requires saved config token + URL: `wallet`, `docs`, `tools`, `send`, `tx`.
- Usually requires wallet funds: `send` and most state-changing `tx` calls.

## Security Guardrails

- Prefer browser PAT approval during setup.
- Do not print PAT values or raw `Authorization` headers.
- Do not pass PAT with `--token` unless non-interactive automation requires it.
- Treat callback URLs and setup state values as one-time sensitive values.

## Troubleshooting

- `cli: command not found`: in this repo use `pnpm start -- <command>`, or run `cli setup --link` once to add the binary to `PATH`.
- `CLI database tables are missing`: apply SQL migrations from the interface repo.
- `Missing CDP credentials`: set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` on the interface server.
- `Canonical /v1 tool routes are unavailable`: route `/v1/tools` and `/v1/tool-executions` from your configured CLI base URL to Chat API.
