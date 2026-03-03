# Coordination Ledger (Active Only)

Use this file only for currently active coding work. Keep it minimal and current.

## Open Entries

| Agent/Session | Task | Files in Scope | Symbols (add/rename/delete) | Dependency Notes | Updated (YYYY-MM-DD) |
| --- | --- | --- | --- | --- | --- |
| codex-gpt5-shared-review-cli-migration-2026-02-25 | Migrate local review launcher to shared package wrapper/config and install shared dependency | `scripts/chatgpt-oracle-review.sh`, `scripts/review-gpt.config.sh`, `package.json`, lockfile, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | replace full local launcher implementation with thin wrapper; add shared package config file | Keep `review:gpt` UX stable while centralizing implementation maintenance | 2026-02-25 |
| codex-gpt5-test-coverage-audit-v1-cutover-2026-03-02 | Test-coverage audit for `/v1` proxy removal hard cutover | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`; tests touching `/v1` ownership boundaries (`apps/web/**` only if needed) | add/adjust tests only; no production symbol changes | Respect active script-migration ownership; ignore unrelated dirty files | 2026-03-02 |
| codex-gpt5-cli-backbone-hardening-2026-03-02 | Harden Incur backbone: stdout discipline, MCP command availability, schema strictness, positional escaping, env consistency, config URL/token ergonomics | `src/{cli.ts,cli-incur.ts}`, `src/commands/{setup.ts,shared.ts,config.ts,docs.ts,tools.ts,send.ts,tx.ts}`, `tests/{cli.test.ts,cli-runtime-coverage.test.ts,backbone-cutover-coverage-audit.test.ts,backbone-cutover-audit-regressions.test.ts,env-contract-hard-cutover.test.ts,send-network-defaults.test.ts,tx-network-defaults.test.ts}`, `skills/cli/SKILL.md`, `README.md`, `agent-docs/references/cli-command-and-data-flow.md`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | add setup stderr logging helper; centralize URL normalization; tighten Incur args/options/output schemas; replace positional escape encoding with base64url; route network defaults through deps.env; clear persisted auth on interface-origin changes without replacement token | Maintain hard cutover behavior; keep MCP non-interactive and hide unsupported interactive commands | 2026-03-02 |
| codex-gpt5-unify-setup-x402-flow-2026-03-02 | Unify onboarding so `setup` can configure Farcaster x402 payer mode (hosted/local) without requiring a separate x402 setup step | `src/{cli-incur.ts,usage.ts}`, `src/commands/{setup.ts,farcaster.ts}`, `tests/{setup-command-coverage.test.ts,cli.test.ts,farcaster-command.test.ts}`, `README.md`, `ARCHITECTURE.md`, `agent-docs/references/cli-command-and-data-flow.md`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | add setup x402 option plumbing + mode normalization/prompting; add setup-time x402 init invocation; remove signup-time automatic x402 setup prompt path; adjust usage/docs/tests accordingly | Preserve existing farcaster x402 commands for explicit status/init; keep non-interactive safety behavior | 2026-03-02 |

## Rules

1. Add a row before your first code edit for every coding task (single-agent and multi-agent).
2. Update your row immediately when scope or symbol-change intent changes.
3. Before deleting or renaming a symbol, check this table for dependencies.
4. Delete your row as soon as the task is complete or abandoned.
5. Leave only the header and empty table when there is no active work.
