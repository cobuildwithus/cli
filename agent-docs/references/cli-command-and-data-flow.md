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

1. Parse `setup` options (`--url`, `--chat-api-url`, `--dev`, `--token|--token-file|--token-stdin`, `--agent`, `--network`).
2. Resolve defaults from config + environment (`BUILD_BOT_URL`, `BUILD_BOT_NETWORK`) plus built-in fallback (`https://co.build`, or `http://localhost:3000` with `--dev`).
3. Resolve chat API URL from explicit input/config/env; fallback to (`https://chat-api.co.build`, or `http://localhost:4000` with `--dev`) and derivation from interface URL for non-co.build hosts.
4. In non-interactive first-time setup, fail closed when URL comes only from `BUILD_BOT_URL` (require explicit `--url`).
5. In non-interactive first-time setup, fail closed when chat API URL comes only from `BUILD_BOT_CHAT_API_URL` (require explicit `--chat-api-url`).
6. Prompt for missing URL when interactive, using resolved default value.
7. Normalize/validate interface URL and chat API URL (auto-add scheme; non-loopback `http` rejected).
8. If token is missing and interactive:
- start one-time localhost callback session with random state,
- open interface `/home` with setup query params,
- wait for origin-checked callback approval payload.
9. Accept at most one token source (`--token`, `--token-file`, `--token-stdin`) and fail on conflicts.
10. If browser approval fails/times out, fall back to hidden token prompt.
11. Persist config locally.
12. Bootstrap wallet via `/api/buildbot/wallet`.
13. Print wallet/bootstrap output and next-step guidance.

## Config and Agent Resolution Flow

1. `readConfig()` loads `~/.buildbot/config.json` if present.
2. `requireConfig()` enforces presence of interface `url` and `token` for remote commands and resolves effective chat API URL.
3. `resolveAgentKey()` prioritizes command `--agent`, then config `agent`, then `default`.

## Network Execution Flow

1. Build payload in handler.
2. `apiPost(pathname, body, options)` selects interface/chat API base URL and resolves endpoint via `toEndpoint`.
3. `toEndpoint` enforces secure base URL policy (`https`, loopback-only `http`) and rejects URL credentials.
4. Send JSON POST with bearer token.
5. Parse response text to JSON when possible.
6. Throw bounded, sanitized, status-prefixed errors for non-2xx or `{ ok: false }`.
7. Emit success payload with `printJson`.

## Docs Query Flow

1. Parse query from positionals and optional `--limit`.
2. Validate query is non-empty and `--limit` is an integer in range.
3. POST `/api/docs/search` with `{ query, limit? }`.
4. Route uses the chat API base URL.
5. Print JSON response from the docs endpoint.

## Tools Flow

1. Parse `tools` subcommand and options.
2. Validate command-specific argument shape.
3. Dispatch to one of:
- `POST /api/buildbot/tools/get-user`
- `POST /api/buildbot/tools/get-cast`
- `POST /api/buildbot/tools/cast-preview`
- `POST /api/buildbot/tools/cobuild-ai-context`
4. Route uses the chat API base URL.
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
