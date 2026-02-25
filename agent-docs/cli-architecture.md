# CLI Architecture

## Purpose

Define durable command/runtime boundaries for `buildbot` CLI behavior.

## Module Map

- Entrypoint: `src/index.ts`
- Router and process lifecycle: `src/cli.ts`
- Command handlers: `src/commands/*.ts`
- Config boundary: `src/config.ts`
- Transport boundary: `src/transport.ts`
- Output/usage boundary: `src/output.ts`, `src/usage.ts`

## Command Surface

### `config`

- `config set --url <interface-url> --token <pat>|--token-file <path>|--token-stdin [--agent <key>]`
- `config show`
- Owns config persistence and masked display.

### `setup`

- `setup [--url <interface-url>] [--dev] [--token <pat>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>]`
- Persists config and performs wallet bootstrap call.
- If token is absent and a TTY is available, opens interface `/home` and waits for secure browser approval over a one-time localhost callback session.
- Default interface URL is `https://co.build` when no URL is configured; `--dev` defaults to `http://localhost:3000`.
- Bare host inputs are normalized (`co.build` -> `https://co.build/`, `localhost:3000` -> `http://localhost:3000/`).
- If non-interactive first-time setup URL comes only from `BUILD_BOT_URL`, setup fails closed and still requires explicit `--url`.
- Falls back to hidden token prompt only if browser approval fails/times out.

### `wallet`

- `wallet [--network <network>] [--agent <key>]`
- Calls `/api/buildbot/wallet` with agent + network context.

### `docs`

- `docs <query> [--limit <n>]`
- Calls `/api/docs/search` with query payload via interface API base URL.
- Used for searchable Cobuild documentation retrieval from configured backend.

### `tools`

- `tools get-user <fname>`
- `tools get-cast <identifier> [--type <hash|url>]`
- `tools cast-preview --text <text> [--embed <url>] [--parent <value>]`
- `tools cobuild-ai-context`
- Calls `/api/buildbot/tools/*` endpoints with command-specific payloads via interface API base URL.
- Intended for read-only access to interface tool routes.

### `send`

- `send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <key>]`
- Calls `/api/buildbot/exec` with `kind: transfer` envelope.
- Enforces UUID v4 idempotency keys, forwards both idempotency headers, and includes the key in success output.
- Always forwards explicit network (`--network`, else `BUILD_BOT_NETWORK`, else `base-sepolia`).

### `tx`

- `tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <key>]`
- Calls `/api/buildbot/exec` with `kind: tx` envelope.
- Enforces UUID v4 idempotency keys, forwards both idempotency headers, and includes the key in success output.
- Always forwards explicit network (`--network`, else `BUILD_BOT_NETWORK`, else `base-sepolia`).

## Boundary Rules

1. CLI UX boundary

- `printUsage()` and command handlers own human-readable errors and hints.
- Help and error text should be explicit and action-oriented.

2. Local config boundary

- Only config helpers should touch `~/.buildbot/config.json`.
- Config stores interface URL and auth metadata (`url`, `token`, `agent`).
- Config structure changes require migration strategy + docs updates.

3. Network boundary

- `apiPost` is the only POST transport path for commands.
- Endpoint composition goes through `toEndpoint` (never raw string concat in handlers).
- Transport enforces secure base URL policy (`https`, except loopback `http`) and rejects embedded credentials.
- `send`/`tx` include both `X-Idempotency-Key` and `Idempotency-Key`.

4. Output boundary

- Machine-readable success output uses pretty JSON (`printJson`).
- Errors are emitted as single-line `Error: <message>` and non-zero exit.

## Update Triggers

Update this doc when changing:

- command names/options/required args,
- `docs`/`tools` command topology or `/api/docs/search` and `/api/buildbot/tools/*` endpoint contracts,
- payload envelopes for `/api/buildbot/wallet` or `/api/buildbot/exec`,
- config file path/schema,
- transport/auth/error normalization behavior,
- skill command guidance in `skills/buildbot-cli/SKILL.md` for the same command/tool changes.
