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

- `config set --url <interface-url> [--chat-api-url <chat-api-url>] --token <pat>|--token-file <path>|--token-stdin [--agent <key>]`
- `config show`
- Owns config persistence and masked display.

### `setup`

- `setup [--url <interface-url>] [--chat-api-url <chat-api-url>] [--dev] [--token <pat>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--payer-mode hosted|local-generate|local-key|skip] [--payer-private-key-stdin|--payer-private-key-file <path>]`
- Persists config, performs wallet bootstrap call, and can configure Farcaster payer mode in the same setup flow.
- If token is absent and a TTY is available, opens interface `/home` and waits for secure browser approval over a one-time localhost callback session.
- Setup approval URL keeps callback/state in the URL fragment and redacts fragment values in terminal display output.
- Default interface URL is `https://co.build` when no URL is configured; `--dev` defaults to `http://localhost:3000`.
- Bare host inputs are normalized (`co.build` -> `https://co.build/`, `localhost:3000` -> `http://localhost:3000/`).
- If non-interactive first-time setup URL comes only from `COBUILD_CLI_URL`, setup fails closed and still requires explicit `--url`.
- Falls back to hidden token prompt only if browser approval fails/times out.

### `wallet`

- `wallet [--network <network>] [--agent <key>]`
- `wallet payer init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]`
- `wallet payer status [--agent <key>]`
- Calls `/api/cli/wallet` with agent + network context.
- `payer init/status` persists and reports per-agent payer-mode metadata at `~/.cobuild-cli/agents/<agent>/wallet/payer.json`.

### `farcaster`

- `farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]`
- `farcaster post --text <text> [--agent <key>] [--fid <n>] [--signer-file <path>] [--idempotency-key <key>] [--verify[=once|poll]|--verify=none]`
- `signup` calls `/api/cli/farcaster/signup` and persists Ed25519 signer key material via SecretRef.
- `post` submits directly to Neynar hub and selects x402 payment source per agent:
  - `hosted` mode calls `/api/cli/farcaster/x402-payment`.
  - `local` mode signs USDC typed data locally and emits `X-PAYMENT` without backend signing.

### `goal`

- `goal create --factory <address> [--params-file <path>|--params-json <json>|--params-stdin] [--network <network>] [--agent <key>] [--idempotency-key <key>]`
- Builds GoalFactory `deployGoal` calldata from JSON params using shared wire ABI contracts.
- Executes through the existing hosted/local wallet split (`/api/cli/exec` in hosted mode, local viem tx in local mode).
- Attempts to decode `GoalDeployed` from the transaction receipt when available.

### `docs`

- `docs <query> [--limit <n>]`
- Calls canonical chat-api tool surfaces through configured chat-api routing (`chatApiUrl` when set, otherwise `url`) with `GET /v1/tools` (when needed) and `POST /v1/tool-executions` (primary).
- If canonical `/v1/*` routes are unavailable, returns actionable guidance to configure `--chat-api-url` (or edge `/v1/*` rewrites) to Chat API.
- Used for searchable Cobuild documentation retrieval from configured backend.

### `tools`

- `tools get-user <fname>`
- `tools get-cast <identifier> [--type <hash|url>]`
- `tools cast-preview --text <text> [--embed <url>] [--parent <value>]`
- `tools get-treasury-stats`
- `tools get-wallet-balances [--agent <key>] [--network <network>]`
- `tools notifications list [--limit <n>] [--cursor <cursor>] [--unread-only] [--kind <discussion|payment|protocol>]`
- Calls canonical chat-api tool execution (`POST /v1/tool-executions`) with optional tool discovery (`GET /v1/tools`) through configured chat-api routing (`chatApiUrl` when set, otherwise `url`).
- Intended for read-only access to canonical tool routes.

### `send`

- `send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <key>]`
- Calls `/api/cli/exec` with `kind: transfer` envelope.
- Validates amount and destination address format before request dispatch.
- Enforces UUID v4 idempotency keys, forwards both idempotency headers, includes the key in success output, and appends it to request-failure errors.
- Always forwards explicit network (`--network`, else `COBUILD_CLI_NETWORK`, else `base-sepolia`).

### `tx`

- `tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <key>]`
- Calls `/api/cli/exec` with `kind: tx` envelope.
- Validates address/calldata/value format before request dispatch.
- Enforces UUID v4 idempotency keys, forwards both idempotency headers, includes the key in success output, and appends it to request-failure errors.
- Always forwards explicit network (`--network`, else `COBUILD_CLI_NETWORK`, else `base-sepolia`).

## Boundary Rules

1. CLI UX boundary

- Incur owns command discovery/help/introspection surfaces (`--help`, compact `--llms`, full `--llms-full`, built-in `--schema`, `completions`, output filtering/token pagination globals, and built-in skills/MCP commands).
- Incur command schemas own primary argument/option parsing; command executors own domain validation and response payloads.
- Help and error text should remain explicit and action-oriented.

2. Local config boundary

- Only config helpers should touch `~/.cobuild-cli/config.json`.
- Config stores interface/chat-api/auth metadata (`url`, optional `chatApiUrl`, `agent`, `auth.tokenRef`, `secrets` providers/defaults).
- Secret values live outside config and resolve via SecretRef providers (`env`, `file`, `exec`), with default file storage at `~/.cobuild-cli/secrets.json`.
- Config structure changes require migration strategy + docs updates.

3. Network boundary

- `apiPost` handles all command POSTs and `apiGet` handles canonical tool discovery.
- Endpoint composition goes through `toEndpoint` (never raw string concat in handlers).
- Transport routes `/v1/*` through `chatApiUrl` when configured; all non-`/v1/*` paths stay on `url`.
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
- payload envelopes for `/api/cli/wallet` or `/api/cli/exec`,
- config file path/schema,
- transport/auth/error normalization behavior,
- skill command guidance in `skills/cli/SKILL.md` for the same command/tool changes.
