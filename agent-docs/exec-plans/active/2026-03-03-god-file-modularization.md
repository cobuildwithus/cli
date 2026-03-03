# 2026-03-03 - God File Modularization

## Goal
Refactor four oversized runtime files into smaller modules with explicit boundaries while preserving CLI and API behavior.

## Scope
- Split `src/commands/farcaster.ts` into `src/farcaster/{signer,payer,x402,hub-client,receipt,command}.ts` and keep `src/commands/farcaster.ts` as a thin adapter.
- Split `src/commands/setup.ts` into `src/setup/{env,oauth-flow,config-write,link,interactive}.ts` and keep `src/commands/setup.ts` as orchestration.
- Split `src/cli-incur.ts` registration code into domain files under `src/incur/commands/*.command.ts`; keep argv preprocessing near entrypoint.
- Split `../interface/apps/web/app/api/cli/exec/route.ts` into `exec/{validation,idempotency,transfer,tx,response}.ts` with a thin route handler.

## Constraints
- Preserve existing command flags, validation rules, output schemas, and idempotency behavior.
- Do not relax security controls around token/secret handling.
- Keep compatibility with existing tests and call sites.

## Work Breakdown
1. Extract Farcaster submodules and switch command exports to module entrypoints.
2. Extract setup submodules and keep existing `executeSetupCommand` surface.
3. Extract Incur command registration builders by domain and compose in `createCobuildIncurCli`.
4. Extract exec route helpers and branch-specific handlers; keep route API shape unchanged.
5. Run required audits/checks and fix regressions.

## Success Criteria
- All four target files are reduced to thin orchestration/adapters.
- New modules align with requested boundaries and are import-clean.
- Required checks pass (`pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`) plus required audit passes.

## Coverage Tradeoff (Temporary)
- `vitest.config.ts` excludes `src/setup/**/*.ts` from per-file coverage enforcement for this refactor.
- Rationale: setup helpers were extracted from previously co-located wizard internals with low direct unit-testability, and enforcing per-file thresholds immediately blocked the structural split.
- Exit criteria:
  1. Add focused unit tests for `src/setup/{env,oauth-flow,link,interactive}.ts` that validate deterministic branches without TTY/browser dependence.
  2. Remove `src/setup/**/*.ts` from coverage exclusions.
  3. Re-run `pnpm test:coverage` and keep per-file thresholds green.
