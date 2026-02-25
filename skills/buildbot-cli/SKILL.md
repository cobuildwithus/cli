---
name: buildbot-cli
description: Configure and operate the Build Bot CLI for setup, wallet bootstrap, send, and tx commands. Use when users ask to run buildbot commands, complete setup with browser approval, inspect wallet details, or automate CLI output in JSON mode.
---

# Build Bot CLI

Use this skill when the task should run through the `buildbot` CLI instead of calling interface APIs directly.

## Canonical Entrypoint

Use a single invocation style:

```bash
buildbot <command>
```

If `buildbot` is not on `PATH` and you are working from this repository checkout, use:

```bash
pnpm start -- <command>
```

## Setup Flow

Run:

```bash
buildbot setup --url <interface-url> --network <network> --agent <agent>
```

For deterministic agent automation, run setup in machine mode:

```bash
buildbot setup --url <interface-url> --network <network> --agent <agent> --json
```

`--json` can also be enabled with `BUILD_BOT_OUTPUT=json`.

For local developer installs, add `--link` to setup to run `pnpm link --global` and make `buildbot` available on PATH:

```bash
buildbot setup --url <interface-url> --network <network> --agent <agent> --link
```

## Core Commands

```bash
buildbot wallet --network <network> --agent <agent>
buildbot send usdc <amount> <to> --network <network> --agent <agent>
buildbot tx --to <address> --data <hex> --value <eth> --network <network> --agent <agent>
```

## Output Contract

- `setup --json` returns an object with `config`, `defaultNetwork`, `wallet`, and `next`.
- `wallet`, `send`, and `tx` print JSON by default.
- Setup wallet address is usually at `wallet.wallet.address`.

## Security Guardrails

- Prefer browser PAT approval during setup.
- Do not print PAT values or raw `Authorization` headers.
- Do not pass PAT with `--token` unless non-interactive automation requires it.
- Treat callback URLs and setup state values as one-time sensitive values.

## Troubleshooting

- `buildbot: command not found`: in this repo use `pnpm start -- <command>`, or run `buildbot setup --link` once to add the binary to `PATH`.
- `Build Bot database tables are missing`: apply SQL migrations from the interface repo.
- `Missing CDP credentials`: set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` on the interface server.
