# CLI setup wizard and idempotency/config hardening

Status: completed
Created: 2026-02-24
Updated: 2026-02-24

## Goal

- Add one-command onboarding (`setup`) and harden execution safety while keeping CLI thin.
- Align idempotency handling with UUID v4 and dual-header forwarding for broker/CDP compatibility.
- Improve local token storage safety via private modes + atomic config writes.

## Success criteria

- `setup` command persists config and performs wallet bootstrap.
- `send` and `tx` reject non-UUID-v4 idempotency keys, emit key to stderr, and send both idempotency header names.
- `send` rejects out-of-range decimals outside `0..255`.
- Config writes use best-effort `0700`/`0600` + atomic rename path.
- Required verification commands pass.

## Scope

- In scope:
- CLI runtime code for setup/idempotency/config write safety.
- CLI tests and docs updates required by architecture/process rules.
- npm release automation artifacts (`scripts/release.sh`, GitHub Actions publish workflow, package metadata/scripts).
- Out of scope:
- Broker API route implementation changes.
- Changes to PAT issuance or backend idempotency persistence strategy.

## Constraints

- Technical constraints:
- Preserve config JSON shape compatibility (`url`, `token`, optional `agent`).
- Never print full PAT values.
- Product/process constraints:
- Run required verification (`typecheck`, `test`, `test:coverage`).
- Complete post-check simplification/coverage/final audit passes.

## Risks and mitigations

1. Risk: Setup prompt behavior can hang in non-TTY test/runtime contexts.
   Mitigation: Require explicit `--url`/`--token` when non-interactive and keep tests non-interactive.
2. Risk: Atomic write behavior may vary by fs implementation.
   Mitigation: Use best-effort rename path with unlink fallback and direct-write fallback.

## Tasks

1. Add `setup` command and CLI routing/usage updates.
2. Enforce UUID-v4 idempotency and dual-header forwarding in `send`/`tx`.
3. Add decimals bounds validation and idempotency stderr output.
4. Harden config write semantics and update remediation guidance.
5. Update tests and architecture/security/reliability docs.
6. Add release script + publish workflow + package metadata updates.
7. Run required verification and completion audits; resolve high-severity findings.

## Decisions

- Keep `--agent` support but default setup agent to `default` for single-agent UX.
- Emit idempotency key to stderr (not stdout JSON) so users can safely retry failed requests.
- Send both `X-Idempotency-Key` and `Idempotency-Key` for compatibility during broker migration.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`
- Expected outcomes:
- All commands exit 0; tests cover setup/idempotency/config changes without regressions.

## Completion audit notes

- Simplification pass: completed; reduced repeated `configPath` lookup in setup and kept behavior unchanged.
- Test-coverage audit pass: completed; added setup failure-mode tests and explicit invalid-idempotency regression test for `send`.
- Final completion audit: no high-severity findings identified in modified CLI paths.
Completed: 2026-02-24
