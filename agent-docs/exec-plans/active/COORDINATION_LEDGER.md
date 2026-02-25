# Coordination Ledger (Active Only)

Use this file only for currently active coding work. Keep it minimal and current.

## Open Entries

| Agent/Session | Task | Files in Scope | Symbols (add/rename/delete) | Dependency Notes | Updated (YYYY-MM-DD) |
| --- | --- | --- | --- | --- | --- |
| codex-gpt5-shared-review-cli-migration-2026-02-25 | Migrate local review launcher to shared package wrapper/config and install shared dependency | `scripts/chatgpt-oracle-review.sh`, `scripts/review-gpt.config.sh`, `package.json`, lockfile, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | replace full local launcher implementation with thin wrapper; add shared package config file | Keep `review:gpt` UX stable while centralizing implementation maintenance | 2026-02-25 |
| codex-gpt5-release-doc-gate-fix-2026-02-25 | Fix release docs-drift enforcement and pnpm action version mismatch | `scripts/release.sh`, `.github/workflows/release.yml`, `README.md`, `agent-docs/references/testing-ci-map.md`, `agent-docs/index.md`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | tighten release check baseline to include docs drift + doc gardening; remove explicit pnpm action version pin | Keep release workflow compatible with packageManager-pinned pnpm and enforce docs/process guards before release | 2026-02-25 |

## Rules

1. Add a row before your first code edit for every coding task (single-agent and multi-agent).
2. Update your row immediately when scope or symbol-change intent changes.
3. Before deleting or renaming a symbol, check this table for dependencies.
4. Delete your row as soon as the task is complete or abandoned.
5. Leave only the header and empty table when there is no active work.
