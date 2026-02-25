# 2026-02-25 Viem Validation Hardening Plan

## Goal
Adopt `viem` as the canonical validation helper for funds-moving CLI input checks.

## Scope
- Add runtime dependency `viem`.
- Replace regex-based address and hex validation with `viem` helpers.
- Keep existing decimal-string semantics unless a behavior change is explicitly needed.
- Update tests only as required by parser/validation behavior.

## Constraints
- Respect active ownership entries in `COORDINATION_LEDGER.md`.
- Keep change focused to validation/dependency files.
- Run required checks and completion workflow audits before handoff.

## Success Criteria
- `send`/`tx` validation paths use `viem` helpers for address/calldata checks.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` pass.
