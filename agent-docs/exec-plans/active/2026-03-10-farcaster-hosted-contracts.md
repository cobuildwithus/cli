# 2026-03-10 - Farcaster hosted contract hard cutover

## Goal

Move the CLI Farcaster hosted-signup and x402 parsing paths onto canonical `@cobuild/wire` contracts so the CLI validates one strict response shape and shares the signup result surface with local execution.

## Scope

- Replace hosted x402 response compatibility parsing with strict shared validation.
- Replace duplicated Farcaster signup result unions/helpers with shared `wire` contracts where applicable.
- Update CLI tests to assert only the canonical hosted/signup contract.

## Non-Goals

- Changing Farcaster post UX beyond contract validation.
- Secret-storage redesign.
- Publishing a new CLI release.

## Risks / Constraints

- Must preserve current signer generation/storage behavior.
- Must not hide backend drift with permissive response parsing.
- Must keep hosted/local execution branches compiling in one change set.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Hard-cut the CLI hosted x402/signup paths to strict shared `wire` validators/builders and removed hosted-response compatibility parsing.
- Verification status:
  - `pnpm build` passed while the repo was temporarily linked to the local `wire` checkout for unpublished contract validation.
  - `pnpm typecheck` passed with the same temporary local-link setup.
  - `pnpm test -- farcaster-command farcaster-local-signup farcaster-x402-coverage-audit` passed.
  - Full `pnpm test` still fails in unrelated tool-catalog/tool-execution suites that already depend on other unpublished `wire` contract work.
  - Reverting the dependency spec/install back to published `@cobuild/wire` succeeds, but `pnpm typecheck` still fails because this repo also depends on other unpublished `wire` exports outside this Farcaster plan.
