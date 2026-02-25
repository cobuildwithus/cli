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

## CI Posture

- GitHub workflow: `.github/workflows/test-and-coverage.yml`.
- CI gates: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` (coverage thresholds enforced by Vitest config).
- Release workflow: `.github/workflows/release.yml` (tag-triggered npm publish with `NPM_TOKEN`).

## Architecture Enforcement Posture

- Required docs artifacts are enforced by drift checks.
- Docs index coverage is enforced by gardening report checks.
- Runtime verification baseline remains `typecheck` + `test`.

## Update Rule

If verification commands or governance scripts change, update this file and `agent-docs/QUALITY_SCORE.md`.
