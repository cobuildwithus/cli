# 2026-03-02 - /v1 Proxy Route Cutover Cleanup

## Goal
Harden CLI behavior for post-cutover deployments where Interface no longer serves runtime `/v1/*` handlers, by surfacing explicit guidance when canonical tool routes are unavailable and aligning docs/skill guidance to the edge-routing requirement.

## Scope
- Update canonical tool execution error handling for unavailable `/v1/tools` and `/v1/tool-executions` routes.
- Tighten retryable status classification for canonical tool-name candidate retries.
- Update tests that assert old generic 404 behavior.
- Update README/architecture/spec/reference/skill docs for route ownership expectations.

## Constraints
- Keep single configured CLI base URL contract (`url`) unchanged.
- Do not reintroduce `chatApiUrl` flags/env/config or legacy endpoint fallback.
- Avoid files/symbols owned by other active ledger entries.

## Work Breakdown
1. Implement explicit canonical-route-unavailable error helper in `src/commands/tool-execution.ts`.
2. Update retryable status set to only route/name mismatch style statuses.
3. Update `tests/tool-execution.test.ts` and affected assertions in `tests/cli.test.ts`.
4. Update `README.md`, `agent-docs/cli-architecture.md`, `agent-docs/product-specs/cli-behavior.md`, `agent-docs/references/cli-command-and-data-flow.md`, and `skills/cli/SKILL.md`.
5. Run required checks.
6. Run completion workflow audit passes (`simplify`, `test-coverage-audit`, `task-finish-review`) and re-run required checks.
7. Commit scoped files and clear ledger entry.

## Success Criteria
- Route-unavailable failures for canonical `/v1/*` paths produce actionable cutover guidance.
- No CLI routing complexity increase (still one base URL).
- Docs/skill guidance explicitly mention `/v1/*` route ownership expectation and self-hosted routing responsibility.
- Required checks and completion audits pass.
