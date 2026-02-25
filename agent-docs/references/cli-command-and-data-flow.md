# CLI Command and Data Flow

## Command Topology

- Entry: `runCliFromProcess()` in `src/cli.ts` (invoked by `src/index.ts`)
- Router:
  - `setup` -> `handleSetupCommand`
  - `config` -> `handleConfigCommand`
  - `wallet` -> `handleWalletCommand`
  - `send` -> `handleSendCommand`
  - `tx` -> `handleTxCommand`

## Input and Option Flow

1. Parse raw argv (`process.argv.slice(2)`).
2. Normalize leading `--` sentinel.
3. Dispatch by top-level command.
4. Per-command parse with `parseArgs` and validate required positionals/options.

## Setup Flow

1. Parse `setup` options (`--url`, `--token|--token-file|--token-stdin`, `--agent`, `--network`).
2. Resolve defaults from config + environment (`BUILD_BOT_URL`, `BUILD_BOT_NETWORK`).
3. In non-interactive first-time setup, fail closed when URL comes only from `BUILD_BOT_URL` (require explicit `--url`).
4. Prompt for missing URL when interactive.
5. If token is missing and interactive:
- start one-time localhost callback session with random state,
- open interface `/home` with setup query params,
- wait for origin-checked callback approval payload.
6. Accept at most one token source (`--token`, `--token-file`, `--token-stdin`) and fail on conflicts.
7. If browser approval fails/times out, fall back to hidden token prompt.
8. Persist config locally.
9. Bootstrap wallet via `/api/buildbot/wallet`.
10. Print wallet/bootstrap output and next-step guidance.

## Config and Agent Resolution Flow

1. `readConfig()` loads `~/.buildbot/config.json` if present.
2. `requireConfig()` enforces presence of `url` and `token` for remote commands.
3. `resolveAgentKey()` prioritizes command `--agent`, then config `agent`, then `default`.

## Network Execution Flow

1. Build payload in handler.
2. `apiPost(pathname, body)` resolves endpoint via `toEndpoint`.
3. `toEndpoint` enforces secure base URL policy (`https`, loopback-only `http`) and rejects URL credentials.
4. Send JSON POST with bearer token.
5. Parse response text to JSON when possible.
6. Throw bounded, sanitized, status-prefixed errors for non-2xx or `{ ok: false }`.
7. Emit success payload with `printJson`.

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
