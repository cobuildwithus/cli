# CLI Agent Docs Index

Last verified: 2026-02-25

## Purpose

This index is the table of contents for durable, repository-local context that agents should use.

## Canonical Docs

| Path                                           | Purpose                                                               | Source of truth                   | Owner               | Review cadence               | Criticality | Last verified |
| ---------------------------------------------- | --------------------------------------------------------------------- | --------------------------------- | ------------------- | ---------------------------- | ----------- | ------------- |
| `ARCHITECTURE.md`                              | System-level architecture map and cross-cutting invariants.           | `src/cli.ts`, `src/commands/**`, scripts, README | CLI Maintainer | Per architecture change      | High        | 2026-02-25    |
| `agent-docs/design-docs/index.md`              | Index for durable design/principles docs.                             | `agent-docs/design-docs/**`        | CLI Maintainer | Monthly                      | Medium      | 2026-02-25    |
| `agent-docs/design-docs/core-beliefs.md`       | Core principles for durable CLI and docs decision-making.             | Team architecture + process decisions | CLI Maintainer | Quarterly                    | Medium      | 2026-02-25    |
| `agent-docs/product-specs/index.md`            | Index for CLI product behavior contracts.                             | `agent-docs/product-specs/**`      | CLI Maintainer | Monthly                      | High        | 2026-02-25    |
| `agent-docs/product-specs/cli-behavior.md`     | User-facing CLI behavior and contract constraints.                    | `src/cli.ts`, `src/commands/**`, `src/transport.ts` | CLI Maintainer | Per behavior-change PR       | High        | 2026-02-25    |
| `agent-docs/PRODUCT_SENSE.md`                  | Product-level user expectations and contract stability rules.         | CLI command behavior + output contracts | CLI Maintainer | Monthly                      | Medium      | 2026-02-25    |
| `agent-docs/cli-architecture.md`               | CLI-specific boundary and command model detail.                       | `src/cli.ts`, `src/commands/**`   | CLI Maintainer | Per command/runtime change   | High        | 2026-02-25    |
| `agent-docs/RELIABILITY.md`                    | Reliability invariants, failure modes, and verification matrix.       | Runtime behavior + scripts        | CLI Maintainer | Per reliability-affecting PR | High        | 2026-02-25    |
| `agent-docs/SECURITY.md`                       | Security trust boundaries, threat model notes, and escalation cues.   | Config/auth handling + API calls  | CLI Maintainer | Per auth/security change     | High        | 2026-02-25    |
| `agent-docs/QUALITY_SCORE.md`                  | Quality posture rubric with evidence and follow-ups.                  | Docs + scripts + verification     | CLI Maintainer | Bi-weekly                    | Medium      | 2026-02-25    |
| `agent-docs/PLANS.md`                          | Plan workflow and storage conventions.                                | `agent-docs/exec-plans/**`        | CLI Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/prompts/simplify.md`               | Reusable simplification pass prompt for behavior-preserving cleanup.  | Agent completion workflow         | CLI Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/prompts/test-coverage-audit.md`    | Reusable coverage-audit prompt for high-impact regression protection. | Agent completion workflow         | CLI Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/prompts/task-finish-review.md`     | Reusable final completion audit prompt for correctness/security.      | Agent completion workflow         | CLI Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/references/README.md`              | Internal reference pack map for implementation details.               | `agent-docs/references/**`        | CLI Maintainer | Monthly                      | Medium      | 2026-02-24    |
| `agent-docs/references/module-boundary-map.md` | Layer ownership and dependency-direction map for CLI surfaces.        | `src/cli.ts`, `src/config.ts`, `src/transport.ts`, scripts | CLI Maintainer | Per architecture-boundary PR | High        | 2026-02-24    |
| `agent-docs/references/cli-command-and-data-flow.md` | Command topology + data flow map.                                | `src/cli.ts`, `src/commands/**`   | CLI Maintainer | Per route/data-flow change   | High        | 2026-02-25    |
| `agent-docs/references/testing-ci-map.md`      | Verification, CI, and release enforcement map (including release verify behavior). | `package.json`, `.github/workflows/test-and-coverage.yml`, `.github/workflows/release.yml`, scripts | CLI Maintainer | Per CI/process change        | Medium      | 2026-02-25    |
| `agent-docs/generated/README.md`               | Generated doc artifacts produced by scripts.                          | `agent-docs/generated/**`         | CLI Maintainer | Per script change            | Medium      | 2026-02-24    |
| `agent-docs/exec-plans/`                       | Execution plans for active and completed work.                        | Plan docs + lifecycle scripts     | CLI Maintainer | Per multi-file/high-risk PR  | High        | 2026-02-25    |
| `agent-docs/exec-plans/tech-debt-tracker.md`   | Rolling debt register with owner/priority/status.                     | Audits and reviews                | CLI Maintainer | Bi-weekly                    | Medium      | 2026-02-24    |

## Conventions

- Keep AGENTS files short and route-oriented.
- Update this index whenever docs are added, removed, or moved.
- Keep docs/tool routing guidance interface-only (`/api/docs/search`, `/api/buildbot/tools/*` via interface base URL).
- When CLI docs/tool command surfaces change, keep `skills/cli/SKILL.md` synchronized in the same change.
- For multi-file/high-risk work, add a plan in `agent-docs/exec-plans/active/`.
- Keep active plan entries current for in-flight runtime changes.
- Keep release baseline docs in sync when changing release/CI scripts (especially `scripts/release.sh`, `.github/workflows/release.yml`, and `agent-docs/references/testing-ci-map.md`).
