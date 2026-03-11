# CLI Farcaster signup planner cutover

Status: complete
Created: 2026-03-11
Updated: 2026-03-11

## Goal

- Replace the CLI’s duplicated Farcaster local-signup planner and local extra-storage parsing with the shared `@cobuild/wire` planner contract while keeping wallet transport and signer persistence local.

## Success criteria

- Local signup consumes the shared planner and shared extra-storage normalization from `wire`.
- The command path preserves current signer generation/storage and hosted-vs-local branching behavior.
- CLI output keeps the canonical shared signup contract for both hosted and local flows.

## Scope

- In scope:
  - Update local signup execution to consume the shared planner.
  - Replace local `--extra-storage` parsing with the shared Farcaster helper.
  - Adjust affected CLI tests/docs for the signup path.
- Out of scope:
  - Farcaster post flow changes unrelated to signup.
  - Secret-storage redesign.

## Constraints

- Technical constraints:
  - Keep local wallet transaction send/wait behavior in the CLI repo.
  - Preserve current signer file/secret storage behavior.
- Product/process constraints:
  - Hard cutover only; do not keep a second planner implementation in the CLI.

## Risks and mitigations

1. Risk: Shared parser error text changes could break CLI UX or tests.
   Mitigation: Reuse the shared helper directly and update tests to assert the canonical messages.
2. Risk: Local execution ordering could change while refactoring onto planner outputs.
   Mitigation: Keep execution transport isolated and continue sending register then add-key in the existing order.

## Tasks

1. Replace local signup planning with the shared `wire` planner/output contract.
2. Swap CLI `extraStorage` parsing over to the shared helper.
3. Update signup-related tests and docs as needed.

## Decisions

- The CLI will keep only local wallet execution, hosted/local routing, and signer persistence after planner extraction.

## Verification

- Commands to run:
  - `pnpm build`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - CLI signup paths compile and pass the repo’s required checks against the shared planner surface.
- Result:
  - All listed commands passed on 2026-03-11 against the live local `wire` install.
