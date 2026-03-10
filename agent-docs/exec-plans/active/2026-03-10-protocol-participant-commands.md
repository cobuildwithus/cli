# 2026-03-10 Protocol Participant Commands

## Goal

Expose a first-class CLI participant write surface for normal protocol actions while keeping keeper/operator maintenance flows and raw-selector escape hatches clearly separated.

## Scope

- Add explicit participant command families backed by `wire` helpers and the shared protocol plan runner:
  - Budget TCR listing lifecycle.
  - Allocation-mechanism listing lifecycle.
  - Round submission lifecycle.
  - Voting / juror commit-reveal-reward flows.
  - Stake / underwriter funding and withdrawal flows.
  - Premium checkpoint / claim flows.
  - Goal / budget donation flows.
  - Juror lifecycle flows.
  - Round prize claim flows.
  - Flow allocation / maintenance flows.
- Add command docs, usage text, JSON output schemas, and behavior tests for the new participant surface.
- Reuse indexed inspect/status commands for discovery where helpful, but require fresh onchain preflight before execution.

## Out Of Scope

- Keeper/operator maintenance commands:
  - `goal sync`
  - `budget activate`
  - `budget sync`
  - `budget finalize-removed`
  - `budget retry-resolution`
  - `budget prune`
  - `mechanism activate`
  - `mechanism release-funds`
  - `flow repair-child-sync-debt`
- Slashing and other punitive permissionless flows.
- Chat API execution tools.

## Constraints

- Keep `tx` as the explicit long-tail escape hatch.
- Prefer explicit, machine-oriented command names over magical inference.
- Do not silently hide approvals; plan output must show every approval and contract-call step.
- Commands should still work when Chat API is unavailable, provided the user supplies explicit protocol identifiers and addresses.

## Parallelization Boundary

- This plan owns command registration, UX, output contracts, and tests for participant commands.
- It depends on the `wire` participant helper work and the CLI plan-runner contract, but command scaffolding and naming can begin in parallel.
- It should not add keeper/operator flows even if the underlying protocol action is permissionless.

## Work Breakdown

1. Finalize the participant command taxonomy and map each command to a `wire` helper + preflight path.
2. Add command handlers and Incur registration for the participant families already covered by current `wire` helpers.
3. Add command handlers for the newly added donation, juror, prize, and flow-allocation helper families.
4. Standardize output, dry-run, and failure behavior across all participant commands.
5. Update CLI docs, usage text, and tests to lock the participant command contract.

## Success Criteria

- The CLI exposes a coherent participant-only protocol write surface without forcing users through raw `tx`.
- Every participant command uses shared `wire` planning plus the shared CLI protocol runner.
- Keeper/operator actions remain clearly outside this command bundle.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: in_progress
Updated: 2026-03-10
