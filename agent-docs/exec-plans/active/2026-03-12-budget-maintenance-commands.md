# 2026-03-12 Budget Maintenance Commands

## Goal

Expose first-class CLI budget maintenance commands for the permissionless BudgetTCR/controller upkeep flows that were intentionally left out of the participant command rollout.

## Scope

- Add CLI commands for:
  - `budget activate`
  - `budget finalize-removed`
  - `budget retry-resolution`
  - `budget prune`
  - `budget sync`
- Reuse shared `@cobuild/wire` planners plus the existing hosted/local wallet execution split.
- Keep maintenance flows distinct from the participant command bundle while preserving the same machine-readable plan/result contract.

## Constraints

- Treat `wire` as the upstream source of truth for calldata planning.
- Do not touch active `revnet`, local-wallet, `flow`, or stake-juror ownership scopes already claimed in the coordination ledger.
- Keep command names explicit and operator-oriented.
- Preserve dry-run, idempotency, hosted/CDP, and local wallet semantics.

## Parallelization Boundary

- Parent `codex-budget-maint-parent` owns shared CLI glue and verification:
  - `src/commands/protocol-budget-maintenance/shared.ts`
  - `src/commands/protocol-budget-maintenance/index.ts`
  - `src/incur/commands/budget.command.ts`
  - `tests/protocol-budget-maintenance-command.test.ts`
- Worker `codex2-budget-activate` owns:
  - `src/commands/protocol-budget-maintenance/activate.ts`
- Worker `codex2-budget-finalize-removed` owns:
  - `src/commands/protocol-budget-maintenance/finalize-removed.ts`
- Worker `codex2-budget-retry-resolution` owns:
  - `src/commands/protocol-budget-maintenance/retry-resolution.ts`
- Worker `codex2-budget-prune` owns:
  - `src/commands/protocol-budget-maintenance/prune.ts`
- Worker `codex2-budget-sync` owns:
  - `src/commands/protocol-budget-maintenance/sync.ts`

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Notes

- `v1-core` is the behavior source of truth for selector names, args, and expected event surfaces.
- Earlier participant-plan docs explicitly left these flows out as keeper/operator maintenance; this task adds that missing maintenance slice without renaming the participant surface.
