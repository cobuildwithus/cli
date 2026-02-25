# 2026-02-25 Funds Safety Hardening Plan

## Goal
Implement high-impact CLI safety hardening for funds-moving commands and privileged transport/config/setup paths based on the latest security review.

## Scope
- Ensure send/tx idempotency keys are surfaced on failure paths.
- Add strict client-side validation for transfer/tx irreversible inputs.
- Prevent auth header override footguns and add network timeout/cancellation.
- Tighten config file permission posture with best-effort chmod hardening.
- Reduce setup approval URL query-string exposure for callback/state values.
- Add and update tests for all changed behavior.

## Constraints
- Respect `AGENTS.md` hard rules and active `COORDINATION_LEDGER.md` ownership.
- No `.env` access.
- Keep changes dependency-free and backward-compatible with existing command contracts unless explicitly changing safety behavior.
- Run required completion workflow and required checks before handoff.

## Work Breakdown
1. Implement code changes in `send`, `tx`, `shared`, `transport`, `config`, `setup-approval`, and setup messaging.
2. Add targeted tests for validation and failure/idempotency behavior.
3. Run simplify, coverage-audit, and finish-review passes.
4. Re-run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
5. Commit scoped files and clean coordination ledger entry.

## Success Criteria
- Failed send/tx operations expose a reusable idempotency key.
- Invalid addresses/calldata/amounts are rejected client-side before API calls.
- Transport blocks reserved header overrides and times out hung requests.
- Config writes attempt to enforce private permissions post-write.
- Setup approval URL no longer sends callback/state in query parameters.
- All required checks pass.
