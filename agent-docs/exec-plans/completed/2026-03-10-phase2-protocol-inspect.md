# 2026-03-10 Phase 2 Protocol Inspect

## Goal

Expose explicit CLI inspect/status commands for the next indexed protocol read slice: TCR requests, arbitrator disputes, stake status, and premium escrow state.

## Scope

- Add explicit CLI commands that execute the canonical `chat-api` inspect tools.
- Keep command output wrapped as untrusted remote-tool data.
- Update command schemas, docs, and tests for the new inspect/status commands.

## Constraints

- Reuse canonical `/v1/tool-executions` contracts.
- Keep write flows out of this slice.
- Do not pull unpublished local `@cobuild/wire` read helpers into the CLI.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
