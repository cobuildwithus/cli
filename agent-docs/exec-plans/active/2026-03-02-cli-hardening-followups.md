# 2026-03-02 - CLI Hardening Follow-ups

## Goal
Implement post-adoption runtime and contract hardening for MCP stdin safety, setup/config defaults, output normalization, and Incur manifest/output schema quality.

## Success Criteria
- MCP runtime rejects command-level stdin reads with clear remediation guidance.
- Setup interactive fallback respects stderr TTY usage.
- Non-MCP buffered stdout preserves blank lines and handles CRLF normalization.
- `config set` requires explicit `--url` when first binding a token and no URL is persisted.
- Default interface/chat API URLs are always persisted in config updates when missing.
- Wallet/farcaster command outputs are schema-described for Incur surfaces.
- Treasury stats canonical tool lookup includes fallback aliases.
- Required checks and completion audit passes are green.

## Scope
- `src/cli.ts`, `src/commands/setup.ts`, `src/commands/config.ts`
- `src/cli-incur.ts`, `src/commands/tools.ts`
- Targeted tests under `tests/**`
- Coordination/architecture docs touched only if behavior contracts require updates

## Non-Goals
- Backward-compatibility reintroduction
- Release/version/tag flows
- Refactoring unrelated pre-existing dirty worktree paths

## Verification
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Completion workflow passes: simplify, test-coverage-audit, task-finish-review
