# 2026-03-10 Protocol Plan Runner

## Goal

Add a reusable CLI execution/runtime layer for `@cobuild/wire` protocol plans so multi-step participant actions can execute safely through the existing hosted/local wallet split.

## Scope

- Add a command-agnostic protocol plan runner that can:
  - present dry-run output for ordered plan steps,
  - execute approval + call steps in order,
  - preserve the current hosted `/api/cli/exec` and local-wallet execution split,
  - attach decoded receipt summaries when a step decoder is available.
- Add root idempotency handling for protocol plans plus deterministic per-step child idempotency keys.
- Normalize plan execution output so participant commands share one machine-readable result contract.
- Add shared command helper modules for step labeling, warnings, and replay-safe resume/error reporting.

## Out Of Scope

- Defining the full participant command taxonomy.
- Changing `/api/cli/exec` request contracts.
- Chat API plan tools or REST changes.
- Non-protocol command surfaces such as Farcaster, docs, or wallet bootstrap.

## Constraints

- Preserve current hosted/local wallet semantics and security boundaries.
- Keep `--dry-run` first-class and explicit about every approval/call step that would execute.
- Maintain replay safety through deterministic idempotency derivation rather than ad hoc per-command behavior.
- Keep network support aligned with the current Base-only protocol surface.

## Parallelization Boundary

- This plan owns shared CLI runtime/execution helpers for protocol plans.
- It should avoid specific participant command registration except for narrow pilot scaffolding needed to prove the runner.
- It can run in parallel with both `wire` plans and with the command-surface plan so long as the output contract stays additive.

## Work Breakdown

1. Add a protocol-plan execution module that consumes `wire` `ProtocolExecutionPlan` objects.
2. Add deterministic child idempotency derivation and replay-safe error/reporting behavior.
3. Add receipt decode plumbing and normalized per-step / aggregate output contracts.
4. Add tests covering hosted execution, local execution, dry runs, and step-failure behavior.
5. Update CLI docs describing the shared runtime contract for participant protocol commands.

## Success Criteria

- CLI has one shared execution path for multi-step protocol plans instead of per-command step orchestration.
- Approval-bearing participant commands can be added without reimplementing wallet execution or idempotency logic.
- Dry-run output is stable and explicit enough for agent and machine use.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-10
Completed: 2026-03-10
