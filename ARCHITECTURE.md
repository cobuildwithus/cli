# Build Bot Architecture

Last updated: 2026-02-25

See `README.md` for setup/use context. Canonical docs map: `agent-docs/index.md`.

## Repository Layout

```text
buildbot/
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
  - `docs`: docs search query via docs search API.
  - `tools`: read-only tool API access (`get-user`, `get-cast`, `cast-preview`, `cobuild-ai-context`).
  - `send`: token transfer execution envelope.
  - `tx`: arbitrary transaction execution envelope.

### Local state runtime

- Config path: `~/.buildbot/config.json`.
- Stored values: `url` (interface base), `chatApiUrl` (chat-api base), `token`, optional `agent`.
- Writes are full-file JSON rewrites with stable formatting.
- Writes use best-effort private directory/file modes and atomic replace (`tmp` + `rename`).
- Source modules: `src/config.ts`, `src/commands/config.ts`.

### Remote API runtime

- All networked command execution routes through `apiPost`.
- Endpoint base URL is selected per command target (`interface` or `chat`) then normalized via `toEndpoint`.
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

- Config file shape remains backward-compatible and additive (`url`, `chatApiUrl`, `token`, `agent`).
- Missing required config fields fail with clear remediation guidance.

3. Command envelope invariant

- `setup` uses a one-time localhost callback session (loopback-only, state-bound, origin-checked) to receive PAT approval from the interface `/home` flow.
- `setup` then persists config and performs a wallet bootstrap call to `/api/buildbot/wallet`.
- `wallet` always targets `/api/buildbot/wallet`.
- `docs` always targets `/api/docs/search` via chat-api base.
- `tools` targets `/api/buildbot/tools/*` via chat-api base.
- `send` and `tx` always target `/api/buildbot/exec` with explicit `kind`.
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
3. Apply interface URL fallback when still missing: `https://co.build` (or `http://localhost:3000` with `--dev`).
4. Resolve chat API URL from explicit input/config/env; otherwise default to `https://chat-api.co.build` (`http://localhost:4000` with `--dev`) or derive from interface URL for non-co.build hosts.
5. If first-time setup is non-interactive and URL comes only from `BUILD_BOT_URL`, fail closed and require explicit `--url`.
6. If first-time setup is non-interactive and chat API URL comes only from `BUILD_BOT_CHAT_API_URL`, fail closed and require explicit `--chat-api-url`.
7. Normalize/validate interface URL and chat API URL (auto-add scheme; reject non-loopback `http`).
8. Accept token source from exactly one input (`--token`, `--token-file`, or `--token-stdin`), otherwise fail.
9. If token is missing and TTY is available, start one-time localhost callback session.
10. Open interface `/home` with setup query params (`buildBotSetup`, callback URL, state) and wait for browser approval.
11. On approval, receive PAT over loopback callback, persist config, and bootstrap wallet.
12. If approval fails/times out, fall back to hidden manual token prompt.

### Wallet lookup flow

1. Parse CLI options (`--network`, `--agent`).
2. Resolve agent key from flag or config default.
3. Build payload and POST `/api/buildbot/wallet`.
4. Print normalized JSON result.

### Token send flow

1. Parse positional args (`token amount to`) plus optional flags.
2. Validate minimum argument contract and optional `--decimals` parsing.
3. Build transfer payload (`kind: transfer`) and POST `/api/buildbot/exec`.
4. Print normalized JSON result with `idempotencyKey` attached.

### Generic tx flow

1. Parse required flags (`--to`, `--data`) and optional value/network/agent.
2. Build tx payload (`kind: tx`) and POST `/api/buildbot/exec`.
3. Print normalized JSON result with `idempotencyKey` attached.

### Docs search flow

1. Parse positional query text and optional `--limit`.
2. Validate non-empty query and `--limit` integer range.
3. Build payload and POST `/api/docs/search`.
4. Print normalized JSON result.

### Buildbot tools flow

1. Parse `tools` subcommand and validate command-specific flags/arguments.
2. Build payload and POST one of:
- `/api/buildbot/tools/get-user`
- `/api/buildbot/tools/get-cast`
- `/api/buildbot/tools/cast-preview`
- `/api/buildbot/tools/cobuild-ai-context`
3. Print normalized JSON result.

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
