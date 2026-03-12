# Coordination Ledger (Active Only)

Use this file only for currently active coding work. Keep it minimal and current.

## Open Entries

| Agent/Session | Task | Files in Scope | Symbols (add/rename/delete) | Dependency Notes | Updated (YYYY-MM-DD) |
| --- | --- | --- | --- | --- | --- |
| codex-revnet-step-idempotency | Re-key child REVNET loan steps from stable execution inputs so label-only copy edits do not change replay behavior across releases. | `src/commands/revnet.ts`, `tests/revnet-command.test.ts`, `agent-docs/exec-plans/active/2026-03-11-revnet-cli-commands.md` | update `deriveRevnetStepIdempotencyKey` seed inputs; add stable replay-key regression coverage | Keep child execution replay semantics downstream of canonical wire step keys and encoded transactions; avoid touching unrelated command groups. | 2026-03-12 |
## Rules

1. Add a row before your first code edit for every coding task (single-agent and multi-agent).
2. Update your row immediately when scope or symbol-change intent changes.
3. Before deleting or renaming a symbol, check this table for dependencies.
4. Delete your row as soon as the task is complete or abandoned.
5. Leave only the header and empty table when there is no active work.
