# 2026-03-12 Protocol Plan Batch Runner

## Goal

Switch the shared CLI protocol-plan runtime so hosted wallets submit a whole validated protocol plan as one hosted request while local wallets keep their current sequential, per-step idempotent execution behavior.

## Scope

- Update the shared protocol-plan runner and output types only.
- Preserve local wallet execution order, child-step idempotency, and receipt decoding behavior.
- Add truthful root execution metadata for hosted dry runs and hosted batch results.
- Extend runner coverage for hosted dry-run, success, replay, and pending/failure cases.

## Constraints

- Treat `wire` as the upstream source of truth for request validation.
- Avoid unrelated active scopes for budget maintenance, terminal funding, and local-wallet lock work.
- Keep the user-facing output additive rather than breaking existing step arrays.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Notes

- Hosted batching belongs in the shared runner because participant plan commands already reuse it.
- Other custom plan executors remain out of scope for this task unless an integration blocker forces follow-up work.

## Status

Status: completed
Updated: 2026-03-12
Completed: 2026-03-12
