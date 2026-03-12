# 2026-03-11 Revnet CLI Commands

## Goal

Add a CLI `revnet` command group for pay, cash-out, loan, and issuance-terms while keeping CLI as the wallet-execution adapter, `@cobuild/wire` as the canonical revnet library, and chat-api canonical for indexed issuance reads.

## Scope

- Add `cli revnet pay`, `cli revnet cash-out`, `cli revnet loan`, and `cli revnet issuance-terms`.
- Reuse existing hosted/local tx execution paths for writes.
- Reuse canonical tool execution for indexed issuance terms.
- Update docs and tests for the new command surface.

## Constraints

- Do not add a second write execution stack in CLI.
- Do not leave the repo committed against a local-link `@cobuild/wire` dependency.
- Respect active ownership boundaries and avoid unrelated generated-doc churn.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed 2026-03-12.

## Delivered Follow-ups

- Re-keyed child loan-step idempotency off the root key, stable step key, and encoded transaction payload so label-only copy edits do not change replay semantics.
- Added command regressions for collateral counts above wallet balance and for `revnet issuance-terms` calls that intentionally omit `--project-id`.
- Kept the wallet execution path unchanged while tightening parity with the shared wire revnet semantics.
