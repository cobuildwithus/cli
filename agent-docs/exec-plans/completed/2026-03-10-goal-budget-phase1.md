# 2026-03-10 Goal Budget Phase 1

## Goal

Add explicit goal/budget inspect commands backed by canonical `chat-api` tools and complete the Base-only CLI cutover without taking an unpublished `wire` dependency.

## Scope

- Add explicit goal and budget inspect commands.
- Remove Base Sepolia protocol assumptions from relevant command/runtime paths and docs.
- Keep `goal create` on the existing implementation until the new shared `wire` helper exports are available from a published package.

## Constraints

- Keep the generic `tx` path as an escape hatch.
- Reuse canonical `/v1/tool-executions` contracts for inspect reads.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-10
Completed: 2026-03-10
