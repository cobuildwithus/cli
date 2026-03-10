# 2026-03-10 OAuth + Tool Contract Cutover

## Goal

Remove tolerant OAuth and `/v1/tools*` response parsing from the CLI and consume the canonical `@cobuild/wire` contract surface instead.

## Scope

- Replace local OAuth response parsing with shared `wire` parsers.
- Replace local tool catalog / execution envelope probing with shared `wire` parsers/builders.
- Update focused tests for the hard cutover behavior.

## Constraints

- Hard cutover only; no legacy envelope support.
- Preserve existing command UX and route-unavailable guidance.
- Avoid unrelated command/runtime work already in the tree.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Verification Outcome

- `pnpm build` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:coverage` failed on unrelated existing per-file coverage thresholds in protocol-participant and incur command files outside this task scope.
