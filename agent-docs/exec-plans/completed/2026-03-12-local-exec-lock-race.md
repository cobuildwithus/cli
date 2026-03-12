# 2026-03-12 Local Exec Lock Race

## Goal

Prevent live same-key local wallet locks from being treated as stale when another process catches the lockfile mid-write, so concurrent retries cannot duplicate a broadcast.

## Scope

- Keep the fix inside `src/wallet/local-exec.ts`.
- Preserve the current `FsLike` dependency surface used by tests and CLI runtime injection.
- Add focused regression coverage in `tests/wallet-local-exec.test.ts`.

## Constraints

- Do not revert or rewrite unrelated in-flight edits already present in `local-exec` files.
- Keep same-key replay/recovery behavior intact for valid stale or recovery locks.
- Maintain the required repo verification and completion-audit workflow.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-12
Completed: 2026-03-12

## Outcome

- Added a shared local-exec file writer so non-exclusive lockfile rewrites now go through temp+rename.
- Changed lock acquisition so transient unreadable lockfiles are only reaped after a full stale window of continuous observation.
- Prevented contenders already inside `acquireLocalExecLock()` from deleting stale prepared/recovery locks that should be replayed.
- Added focused concurrency regressions for partial initial writes, partial lock updates, stale unreadable locks, stale conflicting unprepared locks, and stale prepared-lock recovery while a waiter is already inside the acquire loop.

## Verification

- `pnpm test -- wallet-local-exec` -> passed
- `pnpm build` -> passed
- `pnpm typecheck` -> passed
- `pnpm test` -> passed
- `pnpm test:coverage` -> passed
