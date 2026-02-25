# CLI Command and Data Flow

## Command Topology

- Entry: `runCliFromProcess()` in `src/cli.ts` (invoked by `src/index.ts`)
- Router:
  - `setup` -> `handleSetupCommand`
  - `config` -> `handleConfigCommand`
  - `wallet` -> `handleWalletCommand`
  - `docs` -> `handleDocsCommand`
  - `tools` -> `handleToolsCommand`
  - `send` -> `handleSendCommand`
  - `tx` -> `handleTxCommand`

## Input and Option Flow

1. Parse raw argv (`process.argv.slice(2)`).
2. Normalize leading `--` sentinel.
3. Dispatch by top-level command.
4. Per-command parse with `parseArgs` and validate required positionals/options.

## Setup Flow

1. Parse `setup` options (`--url`, `--dev`, `--token|--token-file|--token-stdin`, `--agent`, `--network`).
2. Resolve defaults from config + environment (`BUILD_BOT_URL`, `BUILD_BOT_NETWORK`) plus built-in fallback (`https://co.build`, or `http://localhost:3000` with `--dev`).
3. In non-interactive first-time setup, fail closed when URL comes only from `BUILD_BOT_URL` (require explicit `--url`).
4. Prompt for missing URL when interactive, using resolved default value.
5. Normalize/validate interface URL (auto-add scheme; non-loopback `http` rejected).
6. If token is missing and interactive:
- start one-time localhost callback session with random state,
- open interface `/home` with setup query params,
- wait for origin-checked callback approval payload.
7. Accept at most one token source (`--token`, `--token-file`, `--token-stdin`) and fail on conflicts.
8. If browser approval fails/times out, fall back to hidden token prompt.
9. Persist config locally.
10. Bootstrap wallet via `/api/buildbot/wallet`.
11. Print wallet/bootstrap output and next-step guidance.

## Config and Agent Resolution Flow

1. `readConfig()` loads `~/.buildbot/config.json` if present.
2. `requireConfig()` enforces presence of interface `url` and `token` for remote commands.
3. `resolveAgentKey()` prioritizes command `--agent`, then config `agent`, then `default`.

## Network Execution Flow

1. Build payload in handler.
2. `apiPost(pathname, body, options)` resolves endpoint from interface base URL via `toEndpoint`.
3. `toEndpoint` enforces secure base URL policy (`https`, loopback-only `http`) and rejects URL credentials.
4. Send JSON POST with bearer token.
5. Parse response text to JSON when possible.
6. Throw bounded, sanitized, status-prefixed errors for non-2xx or `{ ok: false }`.
7. Emit success payload with `printJson`.

## Docs Query Flow

1. Parse query from positionals and optional `--limit`.
2. Validate query is non-empty and `--limit` is an integer in range.
3. POST `/api/docs/search` with `{ query, limit? }`.
4. Route uses the interface API base URL.
5. Print JSON response from the docs endpoint.

## Tools Flow

1. Parse `tools` subcommand and options.
2. Validate command-specific argument shape.
3. Dispatch to one of:
- `POST /api/buildbot/tools/get-user`
- `POST /api/buildbot/tools/get-cast`
- `POST /api/buildbot/tools/cast-preview`
- `POST /api/buildbot/tools/cobuild-ai-context`
4. Route uses the interface API base URL.
5. Print JSON response.

## Idempotency Flow (`send` / `tx`)

1. Resolve idempotency key from `--idempotency-key` or `randomUUID()`.
2. Validate as UUID v4.
3. Send both `X-Idempotency-Key` and `Idempotency-Key` headers.
4. Return the effective key in success payload output.

## Error and Exit Flow

- Handler throws -> `runCliFromProcess(...)` catch -> print `Error: <message>` -> exit code `1`.
- Usage/help commands exit code `0`.

## Update Rule

Update this document when command parsing, config resolution, request payloads, endpoint paths, or error behavior changes.
