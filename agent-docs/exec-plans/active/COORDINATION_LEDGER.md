# Coordination Ledger (Active Only)

Use this file only for currently active coding work. Keep it minimal and current.

## Open Entries

| Agent/Session | Task | Files in Scope | Symbols (add/rename/delete) | Dependency Notes | Updated (YYYY-MM-DD) |
| --- | --- | --- | --- | --- | --- |
| codex-gpt5-v1-cutover-cleanup-2026-03-02 | Harden hard-cutover behavior for canonical /v1 tool routes and remove proxy-assumption ambiguity | `src/commands/tool-execution.ts`, `tests/tool-execution.test.ts`, `tests/cli.test.ts`, `README.md`, `agent-docs/{cli-architecture.md,product-specs/cli-behavior.md,references/cli-command-and-data-flow.md}`, `skills/cli/SKILL.md`, `agent-docs/exec-plans/active/{2026-03-02-v1-proxy-route-cutover-cleanup.md,COORDINATION_LEDGER.md}` | add explicit canonical-route-unavailable error contract for `/v1/tools` + `/v1/tool-executions`; tighten retryable canonical failure classification | Preserve single configured CLI base URL contract; avoid files/symbols owned by other active ledger entries | 2026-03-02 |
| codex-gpt5-shared-review-cli-migration-2026-02-25 | Migrate local review launcher to shared package wrapper/config and install shared dependency | `scripts/chatgpt-oracle-review.sh`, `scripts/review-gpt.config.sh`, `package.json`, lockfile, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | replace full local launcher implementation with thin wrapper; add shared package config file | Keep `review:gpt` UX stable while centralizing implementation maintenance | 2026-02-25 |

## Rules

1. Add a row before your first code edit for every coding task (single-agent and multi-agent).
2. Update your row immediately when scope or symbol-change intent changes.
3. Before deleting or renaming a symbol, check this table for dependencies.
4. Delete your row as soon as the task is complete or abandoned.
5. Leave only the header and empty table when there is no active work.
