# 2026-03-10 Goal Create Wire Cutover

## Goal

Cut CLI `goal create` over to the shared `wire` goal-create plan/decode helpers without changing the hosted/local wallet execution split.

## Scope

- Replace local GoalFactory calldata building and receipt decoding with shared `wire` helpers.
- Keep the current command shape unless a cleanup is clearly required by the shared Base-only contract.
- Update tests and command-flow docs as needed.

## Constraints

- Keep `tx` as the escape hatch.
- Preserve idempotency, dry-run, hosted execution, and local execution behavior.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

