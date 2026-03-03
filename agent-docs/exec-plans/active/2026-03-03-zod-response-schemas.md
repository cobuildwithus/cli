# 2026-03-03 - Zod Response Schemas for Stable CLI API Contracts

## Goal
Reduce manual JSON record parsing for stable API contracts by introducing reusable Zod schemas and using schema parsing in command/runtime code.

## Scope
- Add a shared response-schema module for:
  - OAuth token response
  - CLI wallet response envelope/address extraction
  - `/v1/tools` discovery response envelope
  - `/v1/tool-executions` response envelope
- Replace manual `asRecord()` parsing in:
  - `src/oauth.ts`
  - `src/commands/tool-execution.ts`
  - setup wallet response handling (`src/setup/env.ts` / `src/commands/setup.ts`)
- Keep `asRecord()` in truly unknown payload paths.

## Constraints
- Preserve existing error messages where tests rely on exact strings.
- Preserve command output shapes and fallback semantics.
- Do not weaken defensive parsing behavior around malformed payloads.

## Verification
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Success Criteria
- Stable core API shapes parse via Zod schemas.
- Manual record probing is reduced in listed files.
- Existing behavior/tests remain green.
