# Testing and CI Map

## Local Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`

## Script Enforcement

- Drift checks: `scripts/check-agent-docs-drift.sh`
- Docs inventory/report generation: `scripts/doc-gardening.sh`
- Plan lifecycle: `scripts/open-exec-plan.sh`, `scripts/close-exec-plan.sh`
- Selective commits: `scripts/committer`
- Release guardrails: `scripts/release.sh` (`check`, exact-version + prerelease support, branch/remote/package validation, docs drift/gardening gates before build/pack)
- Release verify script: `pnpm verify` (`pnpm typecheck && pnpm test:coverage`) to avoid duplicate test execution during release checks.

## CI Posture

- GitHub workflow: `.github/workflows/test-and-coverage.yml`.
- CI gates: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` (coverage thresholds enforced by Vitest config).
- Release workflow: `.github/workflows/release.yml` (tag-triggered release with tag/package validation, npm tarball artifact staging, GitHub Release creation, and OIDC trusted npm publish with prerelease dist-tag + idempotent handling).
- Release workflow setup: `pnpm/action-setup@v4` reads pnpm from `packageManager` (do not also pin a conflicting `with.version`).

## Architecture Enforcement Posture

- Required docs artifacts are enforced by drift checks.
- Docs index coverage is enforced by gardening report checks.
- Runtime verification baseline remains `typecheck` + `test`.

## Update Rule

If verification commands or governance scripts change, update this file and `agent-docs/QUALITY_SCORE.md`.
