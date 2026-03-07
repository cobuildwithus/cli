# Wire Published Guard

Status: completed
Created: 2026-03-07
Updated: 2026-03-07

## Goal

- Enforce published `@cobuild/wire` defaults in `cli` verification and CI paths while keeping the opt-in local-link scripts available for cross-repo development.

## Success criteria

- `scripts/wire-ensure-published.sh` resolves the installed repo-tools binary instead of relying on `pnpm exec`.
- `pnpm verify` fails fast when `@cobuild/wire` is committed as a local link.
- CI coverage and test workflows run the same published-wire guard after dependency installation.
- Release verification still passes end to end.

## Scope

- In scope:
  - `scripts/wire-ensure-published.sh`
  - verification and CI workflow gating for published `@cobuild/wire`
  - durable docs for verification/process changes
- Out of scope:
  - runtime CLI behavior unrelated to repo tooling
  - removing the explicit `wire:use-local` developer escape hatch

## Constraints

- Technical constraints:
  - Prefer installed `node_modules/.bin` resolution via shared repo-tools config helpers.
  - Keep `release:check` and existing CI lane structure intact.
- Product/process constraints:
  - Published package defaults should be enforced in committed verification paths, not by informal convention.
  - Match repo docs requirements for process and verification changes.

## Risks and mitigations

1. Risk: verification changes drift from durable docs and fail the docs gate.
   Mitigation: update `agent-docs/references/testing-ci-map.md` and `agent-docs/QUALITY_SCORE.md` in the same change.
2. Risk: CI and local verification diverge.
   Mitigation: add the same `wire:ensure-published` guard to `pnpm verify` and workflow lanes.

## Tasks

1. Swap the wire publish guard wrapper to the installed repo-tools binary helper.
2. Add the published-wire guard to local verify and CI lanes.
3. Update verification docs and rerun the release check baseline.

## Decisions

- Keep `wire:use-local` and `wire:use-published` as explicit developer-only toggles rather than removing them.
- Enforce published-wire defaults in verification and CI paths instead of in all local commands.

## Verification

- Commands to run:
  - `pnpm release:check`
- Expected outcomes:
  - release baseline passes with the published-wire guard executed inside `pnpm verify`
  - docs drift/gardening remain green after the verification-doc updates
Completed: 2026-03-07
