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
