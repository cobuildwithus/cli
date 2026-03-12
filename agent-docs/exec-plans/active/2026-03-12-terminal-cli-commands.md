# 2026-03-12 Terminal CLI Commands

## Goal

Expose the missing goal/community funding-terminal wallet commands in the CLI using shared `wire` planners so the shared protocol-plan runner in `raw-tx` mode handles them.

## Scope

- Add `goal pay`.
- Add `community pay`.
- Add `community add-to-balance`.
- Keep deterministic idempotency and dry-run support for hosted and local execution.
- Update command docs, schema/help output, and CLI skill guidance for the new command surface.

## Constraints

- Reuse shared `wire` planners instead of assembling calldata directly in the CLI.
- Preserve the existing `tx` escape hatch.
- Keep worker-owned command implementation files isolated from parent-owned registration/docs files.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-12

## Outcome

- Added `goal pay`, `community pay`, and `community add-to-balance` wallet commands.
- Reused shared `wire` terminal planners and the shared protocol-plan runner in `raw-tx` mode.
- Added focused command coverage for dry-run, hosted execution, local execution, approval-step ordering, and retry guidance for JSON-only idempotency.
- Updated CLI help, README, skill docs, and architecture/data-flow references.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm docs:drift`
- `pnpm docs:gardening`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-12
