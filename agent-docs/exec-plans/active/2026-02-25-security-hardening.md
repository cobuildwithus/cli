# 2026-02-25 Security Hardening Plan

## Goal
Evaluate the reported high/medium/low issues, add regression tests for confirmed issues, and implement high-impact fixes while preserving CLI usability.

## Scope
- Transport hardening: URL safety and bounded/sanitized error output.
- Browser opener hardening on Windows and option-safe external opener args.
- Setup/config/send/tx safety improvements where risks are credible and low-regret.
- Tests proving pre-fix issue behavior and guarding post-fix behavior.

## Constraints
- Respect `AGENTS.md` hard rules and `COORDINATION_LEDGER` ownership.
- No `.env` reads.
- Run required verification (`pnpm typecheck`, `pnpm test`, `pnpm test:coverage`).
- Run completion audits (`simplify`, `test-coverage-audit`, `task-finish-review`) because production/tests are touched.

## Work Breakdown
1. Validate each reported issue against source behavior and test coverage gaps.
2. Parallelize implementation across subagents with non-overlapping file scopes.
3. Integrate, reconcile, and run required checks.
4. Run completion audit workflow and final checks.
5. Commit via `scripts/committer` with exact touched paths.

## Success Criteria
- Confirmed issues are documented in handoff.
- Fixes include regression tests.
- Required checks and audit workflow complete and green.
