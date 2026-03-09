# 2026-03-09 Wallet Notifications CLI

## Goal

Expose the new wallet notifications read tool through the CLI as `tools notifications list` without duplicating notification business logic in the client.

## Scope

- Add a nested `tools notifications list` command that executes the canonical tool via `/v1/tool-executions`.
- Normalize output with the existing untrusted-remote metadata wrapper.
- Update command docs, usage/help surfaces, and regression tests for parsing and canonical execution.

## Constraints

- Keep the command under `tools`, not `wallet`, to avoid payer-wallet confusion.
- Preserve stable JSON output and current canonical tool discovery/execution flow.
- Reuse saved/default agent config where needed but do not send wallet selectors.

## Verification

- Required checks: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Completion workflow: simplify -> test-coverage-audit -> task-finish-review
Status: completed
Updated: 2026-03-09
Completed: 2026-03-09
