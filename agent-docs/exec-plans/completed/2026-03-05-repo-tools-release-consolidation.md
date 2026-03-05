# Repo Tools Release Consolidation

Status: completed
Created: 2026-03-05
Updated: 2026-03-05

## Goal

- Replace duplicated local release/changelog/release-notes shell implementations with thin wrappers around `@cobuild/repo-tools` while keeping CLI release behavior unchanged.

## Success criteria

- `scripts/release.sh`, `scripts/update-changelog.sh`, and `scripts/generate-release-notes.sh` are thin wrappers.
- Repo-specific release behavior lives in `scripts/repo-tools.config.sh` and `package.json` only.
- Release checks still cover verify/docs/build/package validation.
- Required docs/process checks pass.

## Scope

- In scope: `scripts/release.sh`, `scripts/update-changelog.sh`, `scripts/generate-release-notes.sh`, `scripts/repo-tools.config.sh`, `package.json`, `pnpm-lock.yaml`, active plan docs.
- Out of scope: product/runtime CLI behavior.

## Constraints

- Technical constraints: preserve current release notes output and tag/commit conventions.
- Product/process constraints: do not run an actual release or publish flow.

## Risks and mitigations

1. Risk: shared wrapper changes could recurse through `release:check`.
   Mitigation: make `package.json` `release:check` a concrete check command, not a wrapper call.
2. Risk: docs drift gating could fail on process-script changes.
   Mitigation: keep active plan/ledger current and run docs drift + gardening checks.

## Tasks

1. Move repo-specific release settings into `scripts/repo-tools.config.sh`.
2. Replace duplicated local release helper scripts with `pnpm exec cobuild-*` wrappers.
3. Update package scripts and dependency wiring.
4. Run required docs/process verification and close the plan.

## Decisions

- Keep repo-local wrapper entrypoints for compatibility; centralize the logic in `repo-tools`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `bash scripts/check-agent-docs-drift.sh`
  - `bash scripts/doc-gardening.sh --fail-on-issues`
- Expected outcomes:
  - All commands pass without invoking an actual release.
Completed: 2026-03-05
