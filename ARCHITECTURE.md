# Build Bot Architecture

Last updated: 2026-02-25

See `README.md` for setup/use context. Canonical docs map: `agent-docs/index.md`.

## Repository Layout

```text
build-bot/
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
- `src/cli.ts` owns command parsing, subcommand routing, and top-level error output.
- Command families:
  - `setup`: onboarding wizard + secure browser approval + config persistence + wallet bootstrap.
  - `config`: local config read/write/inspect.
  - `wallet`: wallet lookup via interface API.
  - `send`: token transfer execution envelope.
  - `tx`: arbitrary transaction execution envelope.

### Local state runtime

- Config path: `~/.build-bot/config.json`.
- Stored values: `url`, `token`, optional `agent`.
- Writes are full-file JSON rewrites with stable formatting.
- Writes use best-effort private directory/file modes and atomic replace (`tmp` + `rename`).
- Source modules: `src/config.ts`, `src/commands/config.ts`.

### Remote API runtime

- All networked command execution routes through `apiPost`.
- Endpoint base URL comes from config (`toEndpoint` normalizes slashes).
- Base URL policy enforces `https` by default; `http` is allowed only for loopback hosts (`localhost`, `127.0.0.1`, `::1`).
- Base URLs with embedded credentials (`user:pass@host`) are rejected.
- Auth uses bearer PAT in request header.
- Response handling normalizes JSON and non-JSON failure payloads with bounded, sanitized error text.
- Source modules: `src/transport.ts`, `src/commands/{wallet,send,tx}.ts`.

## Layering Model

- Command and UX orchestration: `src/cli.ts` (`runCli`, `runCliFromProcess`)
- Command handlers: `src/commands/*.ts`
- Local config boundary: `src/config.ts` (`configPath`, `readConfig`, `writeConfig`, `requireConfig`)
- Remote transport boundary: `src/transport.ts` (`toEndpoint`, `apiPost`)
- Shared output behavior: `src/output.ts`, `src/usage.ts`

## Critical Architecture Invariants

1. Secret handling invariant

- CLI must never print full PAT values outside masked config display.
- Failures should avoid leaking sensitive header/body content.

2. Config compatibility invariant

- Config file shape remains backward-compatible (`url`, `token`, `agent`).
- Missing required config fields fail with clear remediation guidance.

3. Command envelope invariant

- `setup` uses a one-time localhost callback session (loopback-only, state-bound, origin-checked) to receive PAT approval from the interface `/home` flow.
- `setup` then persists config and performs a wallet bootstrap call to `/api/build-bot/wallet`.
- `wallet` always targets `/api/build-bot/wallet`.
- `send` and `tx` always target `/api/build-bot/exec` with explicit `kind`.
- `send` and `tx` always forward an explicit network (`--network`, else `BUILD_BOT_NETWORK`, else `base-sepolia`).
- Optional agent options are forwarded without hidden defaults beyond documented behavior.

4. Idempotency invariant

- `send` and `tx` enforce UUID v4 idempotency keys.
- `send` and `tx` forward both `X-Idempotency-Key` and `Idempotency-Key`.
- CLI success payloads include the effective idempotency key for retry correlation.

5. Error normalization invariant

- Non-2xx responses and `{ ok: false }` payloads fail predictably.
- Failure details are status-prefixed, control-character-sanitized, and length-bounded before reaching CLI output.

## Core Flow Maps

### Setup flow

1. Parse `setup` options (`--url`, `--token`, `--agent`, `--network`).
2. Resolve defaults from config and environment fallbacks (`BUILD_BOT_URL`, `BUILD_BOT_NETWORK`).
3. If first-time setup is non-interactive and URL comes only from `BUILD_BOT_URL`, fail closed and require explicit `--url`.
4. Accept token source from exactly one input (`--token`, `--token-file`, or `--token-stdin`), otherwise fail.
5. If token is missing and TTY is available, start one-time localhost callback session.
6. Open interface `/home` with setup query params (`buildBotSetup`, callback URL, state) and wait for browser approval.
7. On approval, receive PAT over loopback callback, persist config, and bootstrap wallet.
8. If approval fails/times out, fall back to hidden manual token prompt.

### Wallet lookup flow

1. Parse CLI options (`--network`, `--agent`).
2. Resolve agent key from flag or config default.
3. Build payload and POST `/api/build-bot/wallet`.
4. Print normalized JSON result.

### Token send flow

1. Parse positional args (`token amount to`) plus optional flags.
2. Validate minimum argument contract and optional `--decimals` parsing.
3. Build transfer payload (`kind: transfer`) and POST `/api/build-bot/exec`.
4. Print normalized JSON result with `idempotencyKey` attached.

### Generic tx flow

1. Parse required flags (`--to`, `--data`) and optional value/network/agent.
2. Build tx payload (`kind: tx`) and POST `/api/build-bot/exec`.
3. Print normalized JSON result with `idempotencyKey` attached.

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
