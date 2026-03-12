# Revnet Loan Balance Guard

Status: completed
Created: 2026-03-11
Updated: 2026-03-11

## Goal

- Reject `cli revnet loan` requests when `--collateral-count` exceeds the wallet's current REV token balance so the CLI fails before trying to build or execute a reverting borrow plan.

## Success criteria

- `executeRevnetLoanCommand` checks the borrow context token balance before plan construction or execution.
- The command returns a deterministic validation error when requested collateral exceeds wallet balance.
- Revnet command tests cover the insufficient-collateral path and keep existing success cases green.

## Scope

- In scope:
- CLI revnet loan validation in `src/commands/revnet.ts`.
- Regression coverage in `tests/revnet-command.test.ts`.
- Out of scope:
- Changes to `@cobuild/wire` borrow context generation.
- Web UI loan dialog behavior, which already validates this condition.

## Constraints

- Technical constraints:
- Use the existing `getRevnetBorrowContext` token balance instead of adding new reads.
- Product/process constraints:
- Keep CLI as a thin wallet-execution adapter over the wire revnet helpers.
- Follow CLI coordination-ledger and required verification workflow.

## Risks and mitigations

1. Risk: Guarding too late still allows borrow-plan construction or tx execution side effects.
   Mitigation: Check `context.token.balance` immediately after fetching the borrow context.
2. Risk: Existing borrow-context mocks omit token balance and fail once the new guard reads it.
   Mitigation: Update all revnet loan test mocks to include realistic token balances.

## Tasks

1. Add the missing collateral balance guard in the revnet loan command.
2. Extend revnet command tests with realistic borrow-context balances and an insufficient-collateral regression case.
3. Run required checks and completion audits, then close the plan.

## Decisions

- Keep this as a CLI-only fix because the shared borrow context already exposes `token.balance`.
- Reuse the cash-out command's balance-error phrasing pattern for consistency.
- Simplify pass found no behavior-preserving cleanup beyond the implemented guard/test changes.
- Coverage audit identified the equality boundary (`balance === collateralCount`) as the highest-impact remaining gap, so the existing successful hosted-loan test now exercises that off-by-one case.
- Keep the pre-existing idempotency-key stability test valid in the already-dirty revnet suite by using a UUID v4 root idempotency key.

## Verification

- Commands to run:
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- All required CLI checks pass after the balance guard and regression test land.
- Executed outcomes:
- `pnpm test -- tests/revnet-command.test.ts` passed.
- `pnpm build` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:coverage` passed.
Completed: 2026-03-11
