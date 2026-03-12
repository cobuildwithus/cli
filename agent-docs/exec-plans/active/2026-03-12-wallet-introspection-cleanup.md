# 2026-03-12 Wallet Introspection Cleanup

## Goal

Investigate the wallet introspection cleanup safely and land the stale participant-plan schema fix that can be completed without crossing currently claimed runner/metadata migration scopes.

## Scope

- Remove the stale `steps[].response` schema field from participant write output.
- Add a focused regression test for the participant schema contract.
- Record the wallet-subcommand investigation result so the next pass can pick it up cleanly.

## Constraints

- Do not edit currently claimed runner, budget-maintenance, terminal-funding, shared CLI metadata, or `src/cli-incur.ts` files.
- Incur cannot mount a sub-CLI with both a root leaf and nested child commands under the same path; a proper wallet split therefore requires either a hard-cut group migration or argv preprocessing in `src/cli-incur.ts`.
- Limit this turn to unowned files plus the coordination ledger/plan entry.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-12

## Outcome

- Removed the dead `steps[].response` field from the shared participant write schema.
- Tightened the `steps[]` item schema to exact declared fields so emitted JSON Schema no longer permits undeclared step keys.
- Added regression coverage against emitted CLI schema to keep the machine-readable contract aligned with `ProtocolPlanStepOutput`.
- Investigated the wallet subcommand split and deferred it: the clean implementation path needs either a `wallet` group cutover or preprocessing in `src/cli-incur.ts`, which is currently owned by another active task.
