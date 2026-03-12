# 2026-03-12 Stake Juror Lifecycle Commands

## Goal

Expose first-class CLI stake-vault juror lifecycle commands backed by the existing `@cobuild/wire` participant planners and the shared hosted/local protocol-plan runner.

## Scope

- Add CLI commands for:
  - `stake opt-in-juror`
  - `stake request-juror-exit`
  - `stake finalize-juror-exit`
  - `stake set-juror-delegate`
- Reuse the current shared protocol-plan runtime for both hosted/CDP and local wallet execution.
- Update command registration, usage/help/schema metadata, tests, and durable CLI docs.

## Constraints

- Treat `wire` as the upstream source of truth; do not duplicate planner logic in CLI.
- Keep command names explicit and participant-oriented.
- Preserve the existing protocol-plan output contract, idempotency behavior, and dry-run semantics.
- Avoid unrelated active `revnet` and local-wallet ownership scopes already claimed in the coordination ledger.

## Parallelization Boundary

- Worker `codex2-stake-juror-impl` owns command implementation and behavior coverage in:
  - `src/commands/protocol-participant-stake-premium.ts`
  - `src/incur/commands/stake.command.ts`
  - `tests/protocol-participant-command.test.ts`
- Worker `codex2-stake-juror-docs` owns command metadata, usage/help/schema coverage, and docs in:
  - `src/cli-incur.ts`
  - `src/usage.ts`
  - `tests/agent-safety-dry-run-schema.test.ts`
  - `README.md`
  - `agent-docs/cli-architecture.md`
  - `agent-docs/references/cli-command-and-data-flow.md`
  - `skills/cli/SKILL.md` if command surface guidance needs syncing

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Notes

- Current review indicates `wire` already exports the juror lifecycle planners and hosted protocol-step allowlist needed for CLI integration, so the planned change is CLI-only unless an unexpected upstream gap appears during implementation.
