# 2026-03-02 - Incur Backbone Cutover

## Goal
Replace the manual top-level CLI router/parser/help runtime with an Incur command tree (`Cli.create` + grouped subcommands), while preserving core command behavior and adopting Incur-native global surfaces (`skills add`, `mcp add`, `--llms`, `--format`, `--json`).

## Success Criteria
- `src/cli.ts` delegates command execution through an Incur-backed runtime.
- Existing command families remain available (`setup`, `config`, `wallet`, `docs`, `tools`, `farcaster`, `send`, `tx`).
- Tests are updated to validate behavior through the new runtime boundary.
- Required docs and `skills/cli/SKILL.md` are updated for changed command/help/output semantics.
- Required checks pass (`pnpm typecheck`, `pnpm test`, `pnpm test:coverage`).

## Scope
- Runtime cutover and command registration in new Incur composition module.
- Adapter updates in command handlers where parser/help or exit behavior changes.
- Test updates for Incur error/help/format flows.
- Architecture and reference docs updates for command/data-flow boundary changes.
- Skills doc updates for docs/tools command surface expectations.

## Non-Goals
- Backward-compatibility layer for old router behavior.
- Release publishing/version/tag operations.
- Refactoring unrelated pre-existing worktree changes.

## Risks / Constraints
- Incur parser/help behavior may change CLI UX (user accepted hard cutover).
- TTY/non-TTY and error stream behavior may differ from legacy runner and require explicit normalization.
- Must not break secret/config storage compatibility at `~/.cobuild-cli/config.json`.

## Verification
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Completion workflow audit passes: simplify, test-coverage-audit, task-finish-review
