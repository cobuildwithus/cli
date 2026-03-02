# 2026-03-01 CLI Chat API Tools Cutover Plan

Status: completed
Created: 2026-03-01
Updated: 2026-03-01

## Goal

- Move `docs` and `tools` command transport from legacy route names to canonical chat-api REST-first tool surfaces while preserving existing command signatures and JSON output contracts.
- Keep the current `url` + PAT config model unchanged and avoid broad auth churn by falling back to existing interface proxy routes if canonical endpoints are unavailable in this codebase.

## Success criteria

- `docs` and `tools` command code targets canonical endpoints (`GET /v1/tools` optional discovery, `POST /v1/tool-executions` execution) as first choice.
- Existing CLI command UX remains stable (same args/flags and same printed JSON shape for successful calls).
- Fallback to legacy `/api/docs/search` and `/api/buildbot/tools/*` paths is scoped to expected compatibility failures only.
- Non-tools command transports (`setup`, `wallet`, `send`, `tx`) remain unchanged.
- Tests are updated and pass for canonical routing/fallback behavior.

## Scope

- In scope:
  - `src/commands/docs.ts`
  - `src/commands/tools.ts`
  - `src/transport.ts` (shared helper/error behavior for fallback gating)
  - impacted tests in `tests/cli.test.ts` and `tests/transport.test.ts`
  - docs updates covering command data-flow and skills guidance
- Out of scope:
  - chat-api server implementation changes
  - interface proxy route redesign
  - CLI config/auth model redesign beyond what fallback requires

## Constraints

- Technical constraints:
  - Keep TypeScript strictness and existing command output envelopes.
  - Do not break existing PAT-based setup/config behavior.
- Product/process constraints:
  - Preserve user-facing command interfaces.
  - Minimize migration risk with compatibility fallback where needed.
  - Respect active ownership boundaries from `COORDINATION_LEDGER.md`.

## Risks and mitigations

1. Risk: Canonical tool execution payload/response shape may differ from legacy route contracts.
   Mitigation: Use normalization helpers in CLI command handlers so canonical success output matches current command output shape.
2. Risk: Canonical endpoints may not be available in current deployed interface/chat-api wiring.
   Mitigation: Add explicit fallback on expected compatibility statuses/errors and document remaining dependency.
3. Risk: Over-broad fallback could hide real server/runtime failures.
   Mitigation: Restrict fallback to not-found/auth/unsupported statuses; preserve original error for other failures.

## Tasks

1. Add canonical tool execution helper(s) in transport with typed fallback decision logic.
2. Migrate `docs` command to canonical tool execution with legacy fallback and output normalization.
3. Migrate `tools` subcommands to canonical tool execution with legacy fallback and output normalization.
4. Update command + transport tests for canonical-first behavior and compatibility fallback.
5. Update architecture/product/reference/skill docs for new transport topology and deferred auth notes.
6. Run required verification (`pnpm typecheck`, `pnpm test`) and capture outcomes.

## Decisions

- Canonical tool execution for this migration uses `POST /v1/tool-executions` with best-effort `GET /v1/tools` discovery to prefer server-published tool names.
- Keep interface URL + PAT as the only CLI config/auth contract in this pass; rely on existing interface proxy behavior for legacy fallback when canonical endpoints remain unavailable.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Typecheck passes with no new type regressions.
  - CLI test suite passes with updated endpoint expectations and fallback coverage.
  - Coverage thresholds remain green for touched command/transport files.
Completed: 2026-03-01
