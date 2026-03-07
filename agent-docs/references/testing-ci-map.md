# Testing and CI Map

## Local Verification Baseline

- `pnpm wire:ensure-published`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`

## Script Enforcement

- Drift checks: `scripts/check-agent-docs-drift.sh` (allows release-artifacts-only commit shape: `package.json` + `CHANGELOG.md` + `release-notes/v<semver>.md` where `<semver>` may include prerelease suffixes)
- Drift checks ignore execution-plan-only churn when deciding whether `agent-docs/index.md` must change.
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` alone does not count as an active execution plan for docs-drift relief.
- Dependency-only `package.json` + optional `pnpm-lock.yaml` updates do not require matching docs updates.
- Docs inventory/report generation: `scripts/doc-gardening.sh`
- Local pre-commit runs doc gardening only when docs/governance files are staged.
- Plan lifecycle: `scripts/open-exec-plan.sh`, `scripts/close-exec-plan.sh`
- Selective commits: `scripts/committer`
- Published dependency guard: `scripts/wire-ensure-published.sh` (must resolve the installed repo-tools binary and reject committed local-link `@cobuild/wire` specs)
- Release guardrails: `scripts/release.sh` (`check`, exact-version + prerelease support, branch/remote/package/repository validation, then `pnpm verify`, `pnpm docs:drift`, `pnpm docs:gardening`, `pnpm build`, and `npm pack --dry-run`; `pnpm verify` includes the published-wire dependency guard)

## CI Posture

- GitHub workflow: `.github/workflows/test-and-coverage.yml`.
- CI gates: `pnpm wire:ensure-published`, `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` (coverage thresholds enforced by Vitest config).
- Release workflow: `.github/workflows/release.yml` (tag-triggered release with tag/package/repository validation, docs drift/gardening gates, npm tarball artifact staging, GitHub Release creation, and OIDC trusted npm publish with prerelease dist-tag + idempotent handling).
- Release workflow setup: `pnpm/action-setup@v4` reads pnpm from `packageManager` (do not also pin a conflicting `with.version`).

## Architecture Enforcement Posture

- Required docs artifacts are enforced by drift checks.
- Docs index coverage is enforced by gardening report checks.
- Runtime verification baseline remains `typecheck` + `test`.

## Update Rule

If verification commands or governance scripts change, update this file and `agent-docs/QUALITY_SCORE.md`.
