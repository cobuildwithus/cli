# 2026-03-12 Flow CLI Commands

## Goal

Expose the missing CLI `flow` participant commands for allocation maintenance using shared `@cobuild/wire` planners plus the existing hosted/local protocol-plan runner.

## Scope

- Add a new `flow` command family with:
  - `flow sync-allocation`
  - `flow sync-allocation-for-account`
  - `flow clear-stale-allocation`
- Reuse shared wire planners and the existing protocol-plan execution runtime for both hosted/CDP and local-wallet execution.
- Add focused flow command coverage and update at least one durable CLI behavior doc for the new command surface.

## Constraints

- Treat `wire` as the CLI source of truth for calldata, action names, and receipt helpers.
- Preserve existing protocol-plan output, dry-run, and idempotency behavior.
- Avoid touching active stake-juror implementation files (`src/commands/protocol-participant-stake-premium.ts`, `src/incur/commands/stake.command.ts`, `tests/protocol-participant-command.test.ts`).
- Keep shared entrypoint edits (`src/cli-incur.ts`, `src/usage.ts`) minimal because another active session owns adjacent stake-juror metadata work there.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Notes

- `wire` currently already covers `flow.sync-allocation-for-account`, but it is missing `flow.sync-allocation` and still models a stale multi-argument `clearStaleAllocation` ABI.
- Receipt decoding should reuse shared flow receipt helpers where practical; do not invent CLI-local calldata builders.

Status: completed
Updated: 2026-03-11
Completed: 2026-03-11
