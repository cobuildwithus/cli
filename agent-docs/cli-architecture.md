# CLI Architecture

## Purpose

Define durable command/runtime boundaries for `cli` CLI behavior.

## Module Map

- Entrypoint: `src/index.ts`
- Runtime composition + command tree: `src/cli-incur.ts`
- Process lifecycle adapters: `src/cli.ts`
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
- Setup approval URL keeps callback/state in the URL fragment and redacts fragment values in terminal display output.
- Default interface URL is `https://co.build` when no URL is configured; `--dev` defaults to `http://localhost:3000`.
- Bare host inputs are normalized (`co.build` -> `https://co.build/`, `localhost:3000` -> `http://localhost:3000/`).
- If non-interactive first-time setup URL comes only from `COBUILD_CLI_URL`, setup fails closed and still requires explicit `--url`.
- Falls back to hidden token prompt only if browser approval fails/times out.

### `wallet`

- `wallet [--network <network>] [--agent <key>]`
- Calls `/api/buildbot/wallet` with agent + network context.

### `farcaster`

- `farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]`
- `farcaster post --text <text> [--agent <key>] [--fid <n>] [--signer-file <path>] [--idempotency-key <key>] [--verify[=once|poll]|--verify=none]`
- `farcaster x402 init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]`
- `farcaster x402 status [--agent <key>]`
- `signup` calls `/api/buildbot/farcaster/signup` and persists Ed25519 signer key material via SecretRef.
- `x402 init/status` persists and reports per-agent payer-mode metadata at `~/.cobuild-cli/agents/<agent>/farcaster/x402-payer.json`.
- `post` submits directly to Neynar hub and selects x402 payment source per agent:
  - `hosted` mode calls `/api/buildbot/farcaster/x402-payment`.
  - `local` mode signs USDC typed data locally and emits `X-PAYMENT` without backend signing.

### `docs`

- `docs <query> [--limit <n>]`
- Calls canonical chat-api tool surfaces via interface API base URL (`GET /v1/tools` when needed, `POST /v1/tool-executions` primary).
- Used for searchable Cobuild documentation retrieval from configured backend.

### `tools`

- `tools get-user <fname>`
- `tools get-cast <identifier> [--type <hash|url>]`
- `tools cast-preview --text <text> [--embed <url>] [--parent <value>]`
- `tools get-treasury-stats`
- Calls canonical chat-api tool execution (`POST /v1/tool-executions`) with optional tool discovery (`GET /v1/tools`) via interface API base URL.
- Intended for read-only access to interface tool routes.

### `send`

- `send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <key>]`
- Calls `/api/buildbot/exec` with `kind: transfer` envelope.
- Validates amount and destination address format before request dispatch.
- Enforces UUID v4 idempotency keys, forwards both idempotency headers, includes the key in success output, and appends it to request-failure errors.
- Always forwards explicit network (`--network`, else `COBUILD_CLI_NETWORK`, else `base-sepolia`).

### `tx`

- `tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <key>]`
- Calls `/api/buildbot/exec` with `kind: tx` envelope.
- Validates address/calldata/value format before request dispatch.
- Enforces UUID v4 idempotency keys, forwards both idempotency headers, includes the key in success output, and appends it to request-failure errors.
- Always forwards explicit network (`--network`, else `COBUILD_CLI_NETWORK`, else `base-sepolia`).

## Boundary Rules

1. CLI UX boundary

- Incur owns command discovery/help surfaces (`--help`, `--llms`, built-in skills/MCP commands).
- Incur command schemas own primary argument/option parsing; command executors own domain validation and response payloads.
- Help and error text should remain explicit and action-oriented.

2. Local config boundary

- Only config helpers should touch `~/.cobuild-cli/config.json`.
- Config stores interface/auth metadata (`url`, `agent`, `auth.tokenRef`, `secrets` providers/defaults).
- Secret values live outside config and resolve via SecretRef providers (`env`, `file`, `exec`), with default file storage at `~/.cobuild-cli/secrets.json`.
- Config structure changes require migration strategy + docs updates.

3. Network boundary

- `apiPost` handles all command POSTs and `apiGet` handles canonical tool discovery.
- Endpoint composition goes through `toEndpoint` (never raw string concat in handlers).
- Transport enforces secure base URL policy (`https`, except loopback `http`) and rejects embedded credentials.
- Transport enforces default timeout+abort semantics and blocks overriding reserved auth/content headers.
- `send`/`tx` include both `X-Idempotency-Key` and `Idempotency-Key`.

4. Output boundary

- Machine-readable success output uses pretty JSON (`printJson`).
- Errors are emitted as single-line `Error: <message>` and non-zero exit.

## Update Triggers

Update this doc when changing:

- command names/options/required args,
- Incur runtime command registration or argv preprocessor compatibility behavior,
- `docs`/`tools` command topology or canonical `/v1/tool-executions` endpoint contracts,
- payload envelopes for `/api/buildbot/wallet` or `/api/buildbot/exec`,
- config file path/schema,
- transport/auth/error normalization behavior,
- skill command guidance in `skills/cli/SKILL.md` for the same command/tool changes.
