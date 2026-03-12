# 2026-03-12 Local Exec Stale Lock Recovery

## Goal

Ensure same-key local wallet retries can recover when a prior process died after acquiring the lock but before persisting a prepared transaction.

## Scope

- Update stale lock handling in `src/wallet/local-exec.ts`.
- Add focused regression coverage in `tests/wallet-local-exec.test.ts`.
- Preserve the existing prepared-tx recovery path and live-lock heartbeat behavior.

## Constraints

- Do not widen the change beyond local wallet idempotency lock handling.
- Keep behavior unchanged for live locks and stale locks that already have a prepared transaction.
- Work on top of the current in-flight local wallet refactor without reverting unrelated edits.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Same-key retries now reclaim stale valid locks that never recorded `preparedTx` instead of polling forever.
- Stale lock recovery now uses owner-fenced lock state so recovered owners cannot be clobbered by the original process resuming later.
- First receipt creation for a submitted tx is now exclusive, so a later broadcast write cannot overwrite a stronger receipt already persisted by a recovery path.

Status: completed
Updated: 2026-03-12
Completed: 2026-03-12
