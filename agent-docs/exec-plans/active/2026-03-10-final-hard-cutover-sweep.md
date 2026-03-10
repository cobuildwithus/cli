# 2026-03-10 Final Hard Cutover Sweep

## Goal

Remove the last docs-command envelope fallbacks so CLI docs reads trust only the canonical `/v1/tool-executions` contract.

## Scope

- `src/commands/docs.ts`
- matching `tests/**`
- matching `agent-docs/**`

## Constraints

- Preserve canonical route discovery/retry behavior.
- Do not reintroduce legacy `data`, scalar, or missing-count docs payload support.
- Keep unrelated OAuth/tool-contract work isolated.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

blocked: code and repo-specific tests passed, but `pnpm test:coverage` still fails on pre-existing coverage thresholds in unrelated protocol participant and incur command files.
