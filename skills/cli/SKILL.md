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

## Setup Flow

Run:

```bash
cli setup --url <interface-url> --network <network> --agent <agent>
```

For deterministic agent automation, run setup in machine mode:

```bash
cli setup --url <interface-url> --network <network> --agent <agent> --json
```

`--json` can also be enabled with `COBUILD_CLI_OUTPUT=json`.

For local developer installs, add `--link` to setup to run `pnpm link --global` and make `cli` available on PATH:

```bash
cli setup --url <interface-url> --network <network> --agent <agent> --link
```

## Core Commands

```bash
cli wallet --network <network> --agent <agent>
cli docs <query> [--limit <n>]
cli tools get-user <fname>
cli tools get-cast <identifier> [--type <hash|url>]
cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
cli tools cobuild-ai-context
cli send usdc <amount> <to> --network <network> --agent <agent>
cli tx --to <address> --data <hex> --value <eth> --network <network> --agent <agent>
```

## Command Routing

- `docs` calls interface API `POST /api/docs/search`.
- `tools get-user|get-cast|cast-preview|cobuild-ai-context` call interface API `POST /api/buildbot/tools/*`.
- `wallet`, `send`, and `tx` call interface API `POST /api/buildbot/wallet` and `POST /api/buildbot/exec`.

## Output Contract

- `setup --json` returns an object with `config`, `defaultNetwork`, `wallet`, and `next`.
- `wallet`, `docs`, `tools`, `send`, and `tx` print JSON by default.
- Setup wallet address is usually at `wallet.wallet.address`.

## Security Guardrails

- Prefer browser PAT approval during setup.
- Do not print PAT values or raw `Authorization` headers.
- Do not pass PAT with `--token` unless non-interactive automation requires it.
- Treat callback URLs and setup state values as one-time sensitive values.

## Troubleshooting

- `cli: command not found`: in this repo use `pnpm start -- <command>`, or run `cli setup --link` once to add the binary to `PATH`.
- `CLI database tables are missing`: apply SQL migrations from the interface repo.
- `Missing CDP credentials`: set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` on the interface server.
