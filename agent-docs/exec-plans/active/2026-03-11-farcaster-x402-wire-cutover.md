# 2026-03-11 - Farcaster x402 wire cutover

## Goal

Cut the CLI Farcaster payer flow over to the canonical `@cobuild/wire` Farcaster x402 signing-request helper so local and hosted paths share the same payment spec.

## Scope

- Replace local typed-data/domain/payment reconstruction in `src/farcaster/x402.ts`.
- Align payer config metadata/output with the shared Farcaster x402 invariants.
- Update focused CLI tests covering Farcaster x402 and wallet config behavior.

## Non-Goals

- Farcaster signup flow changes.
- CLI release/publish work.

## Risks / Constraints

- Must preserve local-vs-hosted source selection and user-facing validation/error text.
- Must not change the hosted response envelope consumed from `interface`.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed after publishing `@cobuild/wire@0.2.1`: the CLI payer flow now consumes the shared signing-request helper and passes verification against the published package.
