# CLI Architecture

Last updated: 2026-03-02

See `README.md` for setup/use context. Canonical docs map: `agent-docs/index.md`.

## Repository Layout

```text
cli/
├── src/            # TypeScript CLI modules and command handlers
├── tests/          # Vitest command/transport/config tests
├── scripts/        # Agent-doc governance + plan lifecycle + committer helper
├── .github/        # CI workflows (typecheck + test + coverage gates)
├── agent-docs/     # Durable architecture, reliability, security, and process docs
├── AGENTS.md       # Agent routing and mandatory workflow
└── package.json
```

## Runtime Composition

### CLI entrypoint

- `src/index.ts` is the executable entrypoint and delegates to `runCliFromProcess`.
- `src/cli.ts` owns process lifecycle adapters and bridges process/test harness IO into the runtime.
- `src/cli-incur.ts` owns command parsing and subcommand routing via Incur (`Cli.create`, command groups, built-in `skills add`, `mcp add`, `--llms`, and `--mcp`).
- Command families:
  - `setup`: onboarding wizard + secure browser approval + config persistence + wallet bootstrap.
  - `config`: local config read/write/inspect.
  - `wallet`: wallet lookup via interface API.
  - `farcaster`: Farcaster signup + posting + x402 payer setup/status orchestration (`signup`, `post`, `x402 init`, `x402 status`).
  - `docs`: docs search query via docs search API.
  - `tools`: read-only tool API access (`get-user`, `get-cast`, `cast-preview`, `get-treasury-stats`).
  - `send`: token transfer execution envelope.
  - `tx`: arbitrary transaction execution envelope.

### Local state runtime

- Config path: `~/.cobuild-cli/config.json`.
- Stored values: `url` (interface base), optional `agent`, auth metadata (`auth.tokenRef`), and secrets provider metadata (`secrets.*`).
- Secret values are resolved through SecretRefs (`env|file|exec` sources), with default file-backed storage at `~/.cobuild-cli/secrets.json`.
- Writes are full-file JSON rewrites with stable formatting.
- Writes use best-effort private directory/file modes and atomic replace (`tmp` + `rename`) with post-write chmod tightening.
- Source modules: `src/config.ts`, `src/commands/config.ts`.

### Remote API runtime

- All networked command execution routes through transport helpers (`apiPost`, `apiGet`).
- Endpoint base URL always uses configured interface URL and is normalized via `toEndpoint`.
- Base URL policy enforces `https` by default; `http` is allowed only for loopback hosts (`localhost`, `127.0.0.1`, `::1`).
- Base URLs with embedded credentials (`user:pass@host`) are rejected.
- Auth uses bearer PAT in request header.
- Request dispatch enforces a default network timeout with abort semantics.
- Custom transport headers cannot override reserved auth/content headers.
- Response handling normalizes JSON and non-JSON failure payloads with bounded, sanitized error text.
- Source modules: `src/transport.ts`, `src/commands/{wallet,farcaster,docs,tools,send,tx}.ts`.

## Layering Model

- Runtime composition and command tree: `src/cli-incur.ts` (`createCobuildIncurCli`, argv compatibility preprocessors)
- Process/test lifecycle adapters: `src/cli.ts` (`runCli`, `runCliFromProcess`)
- Command handlers: `src/commands/*.ts`
- Local config boundary: `src/config.ts` (`configPath`, `readConfig`, `writeConfig`, `requireConfig`)
- Remote transport boundary: `src/transport.ts` (`toEndpoint`, `apiPost`, `apiGet`)
- Shared output behavior: `src/output.ts`, `src/usage.ts`

## Critical Architecture Invariants

1. Secret handling invariant

- CLI must never print full PAT values outside masked config display.
- Failures should avoid leaking sensitive header/body content.

2. Config compatibility invariant

- Config file shape stores interface routing + auth metadata (`url`, `agent`, `auth.tokenRef`, `secrets` provider/default metadata).
- Legacy `chatApiUrl` values are ignored and are not persisted on writes.
- Missing required config fields fail with clear remediation guidance.

3. Command envelope invariant

- `setup` uses a one-time localhost callback session (loopback-only, state-bound, origin-checked) to receive PAT approval from the interface `/home` flow.
- `setup` then persists config and performs a wallet bootstrap call to `/api/buildbot/wallet`.
- `wallet` always targets `/api/buildbot/wallet`.
- `farcaster signup` targets `/api/buildbot/farcaster/signup`, generates Ed25519 signer keys locally, and stores the private signer key via secret provider refs (metadata-only signer file).
- `farcaster x402 init` persists per-agent payer mode metadata (`hosted` or `local`) and payer key refs for local mode.
- `farcaster post` signs cast bytes locally, submits directly to Neynar hub, and resolves `X-PAYMENT` from either hosted backend signing or local typed-data signing depending on payer mode.
- `farcaster post` verification mode defaults to `none`; `--verify` maps to one delayed check (`once`) and `--verify=poll` performs bounded repeated checks.
- `docs` and `tools` target canonical chat-api tool surfaces first (`GET /v1/tools` when needed, `POST /v1/tool-executions`) via interface base.
- `send` and `tx` always target `/api/buildbot/exec` with explicit `kind`.
- `send` and `tx` always forward an explicit network (`--network`, else `COBUILD_CLI_NETWORK`, else `base-sepolia`).
- Optional agent options are forwarded without hidden defaults beyond documented behavior.

4. Idempotency invariant

- `send` and `tx` enforce UUID v4 idempotency keys.
- `send` and `tx` forward both `X-Idempotency-Key` and `Idempotency-Key`.
- CLI success payloads include the effective idempotency key for retry correlation.
- CLI error messages for failed `send`/`tx` requests include the effective idempotency key for safe retries.

5. Error normalization invariant

- Non-2xx responses and `{ ok: false }` payloads fail predictably.
- Failure details are status-prefixed, control-character-sanitized, and length-bounded before reaching CLI output.

## Core Flow Maps

### Setup flow

1. Parse `setup` options (`--url`, `--token`, `--agent`, `--network`).
2. Resolve defaults from config and environment fallbacks (`COBUILD_CLI_URL`, `COBUILD_CLI_NETWORK`).
3. Apply interface URL fallback when still missing: `https://co.build` (or `http://localhost:3000` with `--dev`).
4. If first-time setup is non-interactive and URL comes only from `COBUILD_CLI_URL`, fail closed and require explicit `--url`.
5. Normalize/validate interface URL (auto-add scheme; reject non-loopback `http`).
6. Accept token source from exactly one input (`--token`, `--token-file`, or `--token-stdin`), otherwise fail.
7. If token is missing and TTY is available, start one-time localhost callback session.
8. Open interface `/home` with setup query params for non-secret fields and fragment params for callback/state, then wait for browser approval.
9. On approval, receive PAT over loopback callback, persist PAT via secret provider ref, and bootstrap wallet.
10. If approval fails/times out, fall back to hidden manual token prompt.

### Wallet lookup flow

1. Parse CLI options (`--network`, `--agent`).
2. Resolve agent key from flag or config default.
3. Build payload and POST `/api/buildbot/wallet`.
4. Print normalized JSON result.

### Farcaster signup flow

1. Parse `farcaster signup` options (`--agent`, `--recovery`, `--extra-storage`, `--out-dir`).
2. Resolve agent key from explicit flag or saved config.
3. Generate an Ed25519 signer keypair locally in the CLI process.
4. POST signup payload (`signerPublicKey`, optional recovery/storage options) to `/api/buildbot/farcaster/signup`.
5. On successful completion, persist signer secret locally to a private file and print JSON result.

### Farcaster x402 setup/status flow

1. Parse `farcaster x402 init` options (`--agent`, `--mode`, `--private-key-stdin|--private-key-file`, `--no-prompt`).
2. Resolve payer mode (`hosted`, `local-generate`, `local-key`) with interactive selection when allowed.
3. Persist per-agent payer config at `~/.cobuild-cli/agents/<agent>/farcaster/x402-payer.json`.
4. In local mode, persist payer private key via SecretRef (file-backed by default).
5. `farcaster x402 status` reads payer config and reports payer address, network, token, and per-call micro-USDC cost.

### Farcaster post flow

1. Parse `farcaster post` options (`--agent`, `--text`, `--fid`, `--signer-file`, `--idempotency-key`, `--verify` mode).
2. Resolve signer key + fid from local signer file (or explicit `--fid` override).
3. Resolve agent payer config; fail closed when missing in non-interactive mode.
4. Build `X-PAYMENT` header:
   - `hosted`: POST `/api/buildbot/farcaster/x402-payment` for backend-signed payload.
   - `local`: sign USDC `TransferWithAuthorization` typed data locally and base64-encode x402 payload.
5. Submit cast bytes to `https://hub-api.neynar.com/v1/submitMessage`, retrying once on 402 with fresh payment.
6. Optionally verify inclusion (`once` or bounded `poll`) against `https://hub-api.neynar.com/v1/castById`.
7. Persist idempotency receipts under `~/.cobuild-cli/agents/<agent>/farcaster/posts/<uuid>.json`.

### Token send flow

1. Parse positional args (`token amount to`) plus optional flags.
2. Validate minimum argument contract plus strict amount/address input checks and optional `--decimals` parsing.
3. Build transfer payload (`kind: transfer`) and POST `/api/buildbot/exec`.
4. Print normalized JSON result with `idempotencyKey` attached; on request failure, throw an error that includes the key.

### Generic tx flow

1. Parse required flags (`--to`, `--data`) and optional value/network/agent.
2. Validate `--to`, `--data`, and `--value` formats before request dispatch.
3. Build tx payload (`kind: tx`) and POST `/api/buildbot/exec`.
4. Print normalized JSON result with `idempotencyKey` attached; on request failure, throw an error that includes the key.

### Docs search flow

1. Parse positional query text and optional `--limit`.
2. Validate non-empty query and `--limit` integer range.
3. Resolve docs tool execution against canonical surfaces (`GET /v1/tools` optional, `POST /v1/tool-executions` primary).
4. Normalize to stable `{ query, count, results }` JSON output.

### Buildbot tools flow

1. Parse `tools` subcommand and validate command-specific flags/arguments.
2. Resolve canonical tool name (`GET /v1/tools` optional) and execute `POST /v1/tool-executions`.
3. Normalize output envelopes to preserve command JSON shape.

## Documentation Map

- CLI architecture detail: `agent-docs/cli-architecture.md`
- Reliability model: `agent-docs/RELIABILITY.md`
- Security model: `agent-docs/SECURITY.md`
- Plans workflow: `agent-docs/PLANS.md`
- Boundary and flow references: `agent-docs/references/*.md`

## Verification Baseline

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`
