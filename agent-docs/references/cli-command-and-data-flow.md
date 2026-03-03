# CLI Command and Data Flow

## Command Topology

- Entry: `runCliFromProcess()` in `src/cli.ts` (invoked by `src/index.ts`)
- Runtime router (Incur command tree in `src/cli-incur.ts`):
  - `setup` -> `executeSetupCommand` (omitted when runtime is started with global `--mcp`)
  - `config` -> `executeConfigSetCommand` / `executeConfigShowCommand`
  - `wallet` -> `executeWallet*Command`
  - `farcaster` -> `executeFarcaster*Command`
  - `goal` -> `executeGoalCreateCommand`
  - `docs` -> `executeDocsCommand`
  - `tools` -> `executeTools*Command`
  - `send` -> `executeSendCommand`
  - `tx` -> `executeTxCommand`

## Input and Option Flow

1. Parse raw argv (`process.argv.slice(2)`).
2. Normalize leading `--` sentinel in `runCli`.
3. Preprocess argv compatibility shims in `preprocessIncurArgv`:
- `setup --json` remapped to command-local setup json mode.
- `--json setup ...` remapped to setup-local machine mode (`--setup-json`) while preserving other leading global flags.
- `docs -- --<dashed-term>` preserved via escaped positional passthrough (base64url marker encoding).
- `farcaster post --verify` normalized to `--verify=once`.
- `farcaster signup --extra-storage -<n>` normalized to equals form.
4. Incur resolves command path, parses args/options, and routes directly to structured command executors.
5. Command modules execute directly from Incur inputs via `execute*Command` APIs (no argv reparse shim for docs/tools/wallet/config/send/tx/setup/goal).

## Setup Flow

1. Parse `setup` options (`--url`, `--chat-api-url`, `--dev`, `--token|--token-file|--token-stdin`, `--agent`, `--network`, optional payer setup flags).
2. Resolve defaults from config + environment (`COBUILD_CLI_URL`, `COBUILD_CLI_NETWORK`) plus built-in fallback (`https://co.build`, or `http://localhost:3000` with `--dev`).
3. In non-interactive first-time setup, fail closed when URL comes only from `COBUILD_CLI_URL` (require explicit `--url`).
4. Prompt for missing URL when interactive, using resolved default value.
5. Normalize/validate interface URL (auto-add scheme; non-loopback `http` rejected).
6. If token is missing and interactive:
- start one-time localhost callback session with random state,
- open interface `/home` with setup query params for non-secret fields and fragment params for callback/state,
- wait for origin-checked callback approval payload.
7. Accept at most one token source (`--token`, `--token-file`, `--token-stdin`) and fail on conflicts.
8. If browser approval fails/times out, fall back to hidden token prompt.
9. Persist config locally.
10. Bootstrap wallet via `/api/cli/wallet`.
11. Optionally configure wallet payer mode in the same setup flow (`hosted`, `local-generate`, `local-key`, or `skip`).
12. Emit structured setup result on stdout and emit wizard/progress/prompt text on stderr.

## Config and Agent Resolution Flow

1. `readConfig()` loads `~/.cobuild-cli/config.json` if present.
2. `requireConfig()` enforces presence of interface `url`, resolves chat-api base (`chatApiUrl` with `url` fallback), and resolves PAT from `auth.tokenRef` (or migrates legacy plaintext `token` into a SecretRef).
3. `resolveAgentKey()` prioritizes command `--agent`, then config `agent`, then `default`.
4. `config set` normalizes/validates `--url` and `--chat-api-url`; when interface origin changes without a replacement token, persisted auth refs are cleared to force re-auth.

## Network Execution Flow

1. Build payload in handler.
2. `apiPost(pathname, body, options)` / `apiGet(pathname, options)` resolve endpoints via `toEndpoint` from:
- chat-api base for `/v1/*` (`chatApiUrl` when configured, otherwise `url`)
- interface base for non-`/v1/*` paths (`url`)
3. `toEndpoint` enforces secure base URL policy (`https`, loopback-only `http`) and rejects URL credentials.
4. Transport validates caller-provided headers cannot override reserved auth/content headers.
5. Send authenticated JSON request with bearer token and default timeout+abort semantics.
6. Parse response text to JSON when possible.
7. Throw bounded, sanitized, status-prefixed errors for non-2xx or `{ ok: false }`.
8. Emit success payload with `printJson`.

## Docs Query Flow

1. Parse query from positionals and optional `--limit`.
2. Validate query is non-empty and `--limit` is an integer in range.
3. Optionally GET `/v1/tools` to resolve canonical docs tool naming.
4. POST `/v1/tool-executions` with canonical tool envelope + `{ query, limit? }` input.
5. If canonical routes are unavailable (404 from discovery + execution), throw explicit cutover guidance to configure `--chat-api-url` (or route `/v1/*` to Chat API at the edge).
6. Normalize output to stable `{ query, count, results }` shape and print JSON.

## Wallet Payer Init/Status Flow

1. Parse `wallet payer init` options (`--agent`, `--mode`, `--private-key-stdin|--private-key-file`, `--no-prompt`).
2. Resolve agent key from `--agent` or config default.
3. Resolve mode (`hosted`, `local-generate`, `local-key`) with interactive selection when allowed.
4. Persist per-agent payer metadata at `~/.cobuild-cli/agents/<agent>/wallet/payer.json`.
5. In local mode, persist payer private key via SecretRef file provider by default.
6. `wallet payer status` reads payer metadata and reports payer address/network/token/cost.

## Farcaster Post Flow

1. Parse `farcaster post` options (`--agent`, `--text`, `--fid`, `--signer-file`, `--idempotency-key`, `--verify` mode).
2. Resolve signer secret + fid from local signer file (or explicit `--fid`).
3. Resolve payer mode from per-agent `wallet/payer.json` (prompted setup in interactive mode when missing).
4. Build x402 header:
   - hosted mode: POST `/api/cli/farcaster/x402-payment`
   - local mode: sign USDC `TransferWithAuthorization` typed data locally and base64-encode payload
5. Submit cast bytes to `https://hub-api.neynar.com/v1/submitMessage`.
6. On 402 submit response, mint fresh payment and retry once.
7. Optional verification (`none|once|poll`) queries `https://hub-api.neynar.com/v1/castById`.
8. Persist/replay idempotency receipts under `~/.cobuild-cli/agents/<agent>/farcaster/posts/<uuid>.json`.

## Goal Create Flow

1. Parse `goal create` options (`--factory`, exactly one params source, optional `--network`, `--agent`, `--idempotency-key`).
2. Parse JSON params and extract GoalFactory `DeployParams` payload.
3. Encode `deployGoal` calldata using GoalFactory ABI exported by `@cobuild/wire`.
4. Execute transaction through existing wallet split:
   - hosted mode: POST `/api/cli/exec` with `kind: tx`
   - local mode: execute local wallet tx path
5. Return normalized tx output with idempotency key and attempt receipt decode of `GoalDeployed`.

## Tools Flow

1. Parse `tools` subcommand and options.
2. Validate command-specific argument shape.
3. Optionally GET `/v1/tools` to resolve canonical tool naming.
4. POST `/v1/tool-executions` with command-specific canonical tool input.
5. If canonical routes are unavailable (404 from discovery + execution), throw explicit cutover guidance to configure `--chat-api-url` (or route `/v1/*` to Chat API at the edge).
6. Normalize output envelopes for stable command JSON shape and print JSON response.

## Idempotency Flow (`send` / `tx`)

1. Resolve idempotency key from `--idempotency-key` or `randomUUID()`.
2. Validate as UUID v4.
3. Send both `X-Idempotency-Key` and `Idempotency-Key` headers.
4. Return the effective key in success payload output.
5. Include the effective key in `send`/`tx` request-failure error text for safe retries.

## Error and Exit Flow

- `runCli()` executes Incur with buffered stdout + captured exit signal for deterministic test behavior.
- `runCli()` bypasses output buffering for `--mcp` runtime startup, forces non-interactive deps for MCP mode, and serves an MCP command tree without `setup`.
- Incur non-zero exits are normalized to legacy-style error messages where needed (including unknown command mapping).
- `runCliFromProcess(...)` catches thrown errors -> prints `Error: <message>` to stderr -> exits `1`.
- Help/usage style commands from Incur (`--help`, group help) exit `0`.

## Update Rule

Update this document when command parsing, config resolution, request payloads, endpoint paths, or error behavior changes.
