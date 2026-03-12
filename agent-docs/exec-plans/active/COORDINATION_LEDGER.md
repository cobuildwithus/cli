# Coordination Ledger (Active Only)

Use this file only for currently active coding work. Keep it minimal and current.

## Open Entries

| Agent/Session | Task | Files in Scope | Symbols (add/rename/delete) | Dependency Notes | Updated (YYYY-MM-DD) |
| --- | --- | --- | --- | --- | --- |
| codex-cli-hard-cutover | Finish the remaining CLI hard cutover by unifying protocol-plan execution, moving schema metadata ownership to command registration, hard-cutting wallet subcommands, centralizing wallet-context resolution, collapsing duplicate send/tx scaffolding, and applying the required simplify pass. | `agent-docs/exec-plans/active/2026-03-12-cli-hard-cutover-sweep.md`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `agent-docs/cli-architecture.md`, `agent-docs/references/cli-command-and-data-flow.md`, `README.md`, `skills/cli/SKILL.md`, `src/cli-incur.ts`, `src/commands/goal.ts`, `src/commands/protocol-budget-maintenance/shared.ts`, `src/commands/revnet.ts`, `src/commands/send.ts`, `src/commands/terminal-funding-shared.ts`, `src/commands/tx.ts`, `src/commands/wallet.ts`, `src/commands/wallet-write-shared.ts`, `src/incur/commands/budget.command.ts`, `src/incur/commands/command-wrapper-shared.ts`, `src/incur/commands/community.command.ts`, `src/incur/commands/docs.command.ts`, `src/incur/commands/farcaster.command.ts`, `src/incur/commands/flow.command.ts`, `src/incur/commands/goal.command.ts`, `src/incur/commands/premium.command.ts`, `src/incur/commands/revnet.command.ts`, `src/incur/commands/stake.command.ts`, `src/incur/commands/tcr.command.ts`, `src/incur/commands/tools.command.ts`, `src/incur/commands/vote.command.ts`, `src/incur/commands/wallet.command.ts`, `src/protocol-plan/executor-shared.ts`, `src/protocol-plan/runner.ts`, `src/protocol-plan/types.ts`, `src/usage.ts`, `src/wallet/commands.ts`, `src/wallet/payer-config.ts`, `tests/agent-safety-dry-run-schema.test.ts`, `tests/cli-runtime-coverage.test.ts`, `tests/local-wallet-command-coverage.test.ts`, `tests/protocol-plan-runner.test.ts`, `tests/wallet-commands.test.ts`, `tests/wallet-payer-config.test.ts` | add `registerSchemaMetadata`; add `createCommandGroup`; add `resolveConfiguredWalletContext`; rename/remove `executeRawTxProtocolPlan`, `buildRawTxProtocolPlanCommandOutput`, `resolveStoredProtocolPlanWalletContext`; delete `executeWalletCommand` and the `wallet` leaf action arg path; add `wallet status` and `wallet init` subcommands; add shared wallet-write executor helpers; simplify `executeLocalProtocolPlanStep` request flow | User approved a hard cutover and confirmed no parallel CLI ownership should remain. This row supersedes the stale 2026-03-12 CLI command slices and owns any follow-up audits for these files, including the simplify pass. | 2026-03-12 |

## Rules

1. Add a row before your first code edit for every coding task (single-agent and multi-agent).
2. Update your row immediately when scope or symbol-change intent changes.
3. Before deleting or renaming a symbol, check this table for dependencies.
4. Delete your row as soon as the task is complete or abandoned.
5. Leave only the header and empty table when there is no active work.
