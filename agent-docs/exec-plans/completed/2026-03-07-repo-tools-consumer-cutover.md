# Repo Tools Consumer Cutover

Status: completed
Created: 2026-03-07
Updated: 2026-03-07

## Goal

- Replace remaining duplicated local audit/dependency-switch script logic with shared `@cobuild/repo-tools` bins while keeping the same local script entrypoints.

## Success criteria

- Local wrapper scripts call published repo-tools bins instead of carrying duplicated logic.
- Repo-specific audit bundle behavior remains encoded in local config, not hardcoded in repo-tools.
- `package.json` and `pnpm-lock.yaml` use the published repo-tools version that contains the new bins.
- Required checks pass.

## Scope

- In scope: audit/wire helper wrappers, repo-tools config, package metadata/lockfile, execution-plan docs.
- Out of scope: CLI runtime behavior beyond these helper scripts.

## Constraints

- Preserve existing script names and package.json script commands.
- Do not change `review:gpt` UX.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`
Completed: 2026-03-07
