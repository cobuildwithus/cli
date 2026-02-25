# Reliability

## Core Invariants

1. Required config (`url`, `token`) is validated before network execution.
2. Command payload contracts remain stable and explicit.
3. API failures normalize to actionable, bounded CLI errors.
4. Local config writes are atomic full rewrites with deterministic JSON formatting.
5. `send` and `tx` always send explicit network values (never rely on server-side default network).

## Reliability-Critical Surfaces

- Entry and dispatch: `src/cli.ts` (`runCli`, `runCliFromProcess`)
- Command handling: `src/commands/{config,wallet,send,tx}.ts`
- Config boundary: `src/config.ts` (`configPath`, `readConfig`, `writeConfig`, `requireConfig`)
- Endpoint + transport: `src/transport.ts` (`toEndpoint`, `apiPost`)
- Error reporting and process exit: `runCliFromProcess(...)`

## Common Failure Modes and Expected Behavior

1. Missing config values

- CLI exits with clear remediation (`buildbot setup` recommended).

2. Invalid command usage

- CLI exits with explicit usage guidance for the affected command.

3. Remote API non-2xx or `{ ok: false }`

- CLI surfaces normalized error message without stack traces or token leaks.

4. Non-JSON API response

- CLI wraps payload text into bounded error handling path.

5. Insecure base URL configuration

- Non-loopback `http` base URLs and credential-bearing URLs fail before request dispatch.

6. Invalid `--decimals`

- CLI rejects non-integer values and out-of-range values outside `0..255`.

7. Invalid idempotency key

- CLI rejects non-UUID-v4 `--idempotency-key` values before network calls.

## Verification Matrix

- Baseline: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Docs/process coupling: `bash scripts/check-agent-docs-drift.sh`
- Docs freshness: `bash scripts/doc-gardening.sh --fail-on-issues`

## High-Value Tests to Keep Healthy

- Missing-config command failures.
- Endpoint construction for base URL and path normalization.
- Command payload shape for wallet/send/tx.
- Error normalization for non-JSON and `{ ok: false }` responses.
- Setup/config token-source exclusivity (`--token`, `--token-file`, `--token-stdin`).
- Secure base URL validation and pre-request rejection semantics.
