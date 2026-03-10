# CLI Command and Data Flow

## Command Topology

- Entry: `runCliFromProcess()` in `src/cli.ts` (invoked by `src/index.ts`)
- Runtime router (Incur command tree in `src/cli-incur.ts`):
  - `setup` -> `executeSetupCommand` (omitted when runtime is started with global `--mcp`)
  - `config` -> `executeConfigSetCommand` / `executeConfigShowCommand`
  - `wallet` -> `executeWallet*Command`
  - `farcaster` -> `executeFarcaster*Command`
  - `goal` -> `executeGoal*Command`
  - `budget` -> `executeBudgetInspectCommand`
  - `tcr` -> `executeTcrInspectCommand`
  - `vote` -> `executeVoteStatusCommand`
  - `stake` -> `executeStakeStatusCommand`
  - `premium` -> `executePremiumStatusCommand`
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
- Leading Incur globals used before a command (`--llms`, `--llms-full`, `--schema`, `--filter-output`, `--token-count`, `--token-limit`, `--token-offset`, `--format`, `--verbose`) are preserved so command-local positional compatibility shims still run on the actual command tail.
- `docs -- --<dashed-term>` preserved via escaped positional passthrough (base64url marker encoding).
- `farcaster post --verify` normalized to `--verify=once`.
- `farcaster signup --extra-storage -<n>` normalized to equals form.
4. Incur resolves command path, parses args/options, and routes directly to structured command executors.
5. Command modules execute directly from Incur inputs via `execute*Command` APIs (no argv reparse shim for docs/tools/wallet/config/send/tx/setup/protocol inspect commands).

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

1. Parse `goal create` options (optional `--factory`, exactly one params source, optional `--network`, `--agent`, `--idempotency-key`).
2. Parse JSON params and hand the raw payload to shared `@cobuild/wire` goal-create normalization/build helpers.
3. Default to the canonical Base GoalFactory from `@cobuild/wire` unless `--factory` overrides it.
4. Encode `deployGoal` calldata using the shared `@cobuild/wire` transaction builder.
5. Execute transaction through existing wallet split:
   - hosted mode: POST `/api/cli/exec` with `kind: tx`
   - local mode: execute local wallet tx path
6. Return normalized tx output with idempotency key and attempt receipt decode of `GoalDeployed` through shared wire decoders.

## Shared Protocol Plan Runtime Flow

1. A command or helper builds a structural `ProtocolExecutionPlan` object (normally from `@cobuild/wire`).
2. `executeProtocolPlan(...)` resolves agent key, stored wallet mode, normalized Base network, and a root idempotency key.
3. The runner derives deterministic child idempotency keys from the root key plus step identity so retries reuse the same per-step ids.
4. In `--dry-run`, the runner returns one normalized plan envelope with every step labeled, requested tx payload shown, and hosted-vs-local execution target explicit.
5. In execute mode, steps run sequentially:
   - hosted mode: POST `/api/cli/exec` with `kind: tx` plus both idempotency headers.
   - local mode: call the local wallet tx path with the derived child idempotency key.
6. If a step decoder is configured and a transaction hash is available, the runner fetches the receipt from Base RPC and attaches a serialized receipt summary or decode warning to that step.
7. On step failure, the runner throws a replay-safe error that names the failed step, the child idempotency key, the root idempotency key, and the retry guidance to rerun with the same root key.

## Indexed Protocol Inspect Flow

1. Parse the protocol command path and required identifiers:
- `goal inspect <identifier>`
- `budget inspect <identifier>`
- `tcr inspect <identifier>`
- `vote status <identifier> [--juror <address>]`
- `stake status <identifier> <account>`
- `premium status <identifier> [--account <address>]`
2. Validate required args/options before any network request.
3. Optionally GET `/v1/tools` to resolve canonical tool naming.
4. POST `/v1/tool-executions` with the canonical tool envelope and structured input:
- `get-goal`
- `get-budget`
- `get-tcr-request`
- `get-dispute`
- `get-stake-position`
- `get-premium-escrow`
5. If canonical routes are unavailable (404 from discovery + execution), throw explicit cutover guidance to configure `--chat-api-url` (or route `/v1/*` to Chat API at the edge).
6. Wrap the response as untrusted remote-tool data before printing JSON.

## Tools Flow

1. Parse `tools` subcommand and options.
2. For `tools notifications list`, validate `--limit` as an integer in `1..50`, accept optional opaque `--cursor`, repeated `--kind`, and `--unread-only`.
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
