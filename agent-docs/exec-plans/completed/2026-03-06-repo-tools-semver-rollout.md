# Repo Tools Semver Rollout

Status: completed
Created: 2026-03-06
Updated: 2026-03-06

## Goal

- Replace the local `file:../repo-tools` dependency with published `@cobuild/repo-tools@^0.1.4` without changing runtime behavior.

## Success criteria

- `package.json` and `pnpm-lock.yaml` reference `^0.1.4`.
- Existing repo-tool-backed scripts still resolve through installed package bins.
- Required process checks pass.

## Scope

- In scope: `package.json`, `pnpm-lock.yaml`, execution-plan lifecycle docs.
- Out of scope: CLI runtime behavior.

## Constraints

- Technical constraints: preserve current release/review script behavior.
- Product/process constraints: no release/publish actions.

## Risks and mitigations

1. Risk: installed bin resolution differs from local file dependency resolution.
   Mitigation: rerun required checks that exercise repo-tool wrappers.

## Tasks

1. Update dependency spec and lockfile.
2. Run required process checks.
3. Close plan and remove ledger row.

## Decisions

- Keep runtime script entrypoints unchanged; only switch package source.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`

Completed: 2026-03-06
