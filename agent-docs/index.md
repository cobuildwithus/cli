# Build Bot Agent Docs Index

Last verified: 2026-02-25

## Purpose

This index is the table of contents for durable, repository-local context that agents should use.

## Canonical Docs

| Path                                           | Purpose                                                               | Source of truth                   | Owner               | Review cadence               | Criticality | Last verified |
| ---------------------------------------------- | --------------------------------------------------------------------- | --------------------------------- | ------------------- | ---------------------------- | ----------- | ------------- |
| `ARCHITECTURE.md`                              | System-level architecture map and cross-cutting invariants.           | `src/cli.ts`, `src/commands/**`, scripts, README | Build Bot Maintainer | Per architecture change      | High        | 2026-02-25    |
| `agent-docs/design-docs/index.md`              | Index for durable design/principles docs.                             | `agent-docs/design-docs/**`        | Build Bot Maintainer | Monthly                      | Medium      | 2026-02-25    |
| `agent-docs/design-docs/core-beliefs.md`       | Core principles for durable CLI and docs decision-making.             | Team architecture + process decisions | Build Bot Maintainer | Quarterly                    | Medium      | 2026-02-25    |
| `agent-docs/product-specs/index.md`            | Index for CLI product behavior contracts.                             | `agent-docs/product-specs/**`      | Build Bot Maintainer | Monthly                      | High        | 2026-02-25    |
| `agent-docs/product-specs/cli-behavior.md`     | User-facing CLI behavior and contract constraints.                    | `src/cli.ts`, `src/commands/**`, `src/transport.ts` | Build Bot Maintainer | Per behavior-change PR       | High        | 2026-02-25    |
| `agent-docs/PRODUCT_SENSE.md`                  | Product-level user expectations and contract stability rules.         | CLI command behavior + output contracts | Build Bot Maintainer | Monthly                      | Medium      | 2026-02-25    |
| `agent-docs/cli-architecture.md`               | CLI-specific boundary and command model detail.                       | `src/cli.ts`, `src/commands/**`   | Build Bot Maintainer | Per command/runtime change   | High        | 2026-02-25    |
| `agent-docs/RELIABILITY.md`                    | Reliability invariants, failure modes, and verification matrix.       | Runtime behavior + scripts        | Build Bot Maintainer | Per reliability-affecting PR | High        | 2026-02-25    |
| `agent-docs/SECURITY.md`                       | Security trust boundaries, threat model notes, and escalation cues.   | Config/auth handling + API calls  | Build Bot Maintainer | Per auth/security change     | High        | 2026-02-25    |
| `agent-docs/QUALITY_SCORE.md`                  | Quality posture rubric with evidence and follow-ups.                  | Docs + scripts + verification     | Build Bot Maintainer | Bi-weekly                    | Medium      | 2026-02-24    |
| `agent-docs/PLANS.md`                          | Plan workflow and storage conventions.                                | `agent-docs/exec-plans/**`        | Build Bot Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/prompts/simplify.md`               | Reusable simplification pass prompt for behavior-preserving cleanup.  | Agent completion workflow         | Build Bot Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/prompts/test-coverage-audit.md`    | Reusable coverage-audit prompt for high-impact regression protection. | Agent completion workflow         | Build Bot Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/prompts/task-finish-review.md`     | Reusable final completion audit prompt for correctness/security.      | Agent completion workflow         | Build Bot Maintainer | Per process change           | Medium      | 2026-02-24    |
| `agent-docs/references/README.md`              | Internal reference pack map for implementation details.               | `agent-docs/references/**`        | Build Bot Maintainer | Monthly                      | Medium      | 2026-02-24    |
| `agent-docs/references/module-boundary-map.md` | Layer ownership and dependency-direction map for CLI surfaces.        | `src/cli.ts`, `src/config.ts`, `src/transport.ts`, scripts | Build Bot Maintainer | Per architecture-boundary PR | High        | 2026-02-24    |
| `agent-docs/references/cli-command-and-data-flow.md` | Command topology + data flow map.                                | `src/cli.ts`, `src/commands/**`   | Build Bot Maintainer | Per route/data-flow change   | High        | 2026-02-25    |
| `agent-docs/references/testing-ci-map.md`      | Verification and CI/local enforcement map.                            | `package.json`, `.github/workflows/test-and-coverage.yml`, scripts | Build Bot Maintainer | Per CI/process change        | Medium      | 2026-02-24    |
| `agent-docs/generated/README.md`               | Generated doc artifacts produced by scripts.                          | `agent-docs/generated/**`         | Build Bot Maintainer | Per script change            | Medium      | 2026-02-24    |
| `agent-docs/exec-plans/`                       | Execution plans for active and completed work.                        | Plan docs + lifecycle scripts     | Build Bot Maintainer | Per multi-file/high-risk PR  | High        | 2026-02-24    |
| `agent-docs/exec-plans/tech-debt-tracker.md`   | Rolling debt register with owner/priority/status.                     | Audits and reviews                | Build Bot Maintainer | Bi-weekly                    | Medium      | 2026-02-24    |

## Conventions

- Keep AGENTS files short and route-oriented.
- Update this index whenever docs are added, removed, or moved.
- For multi-file/high-risk work, add a plan in `agent-docs/exec-plans/active/`.
- Keep active plan entries current for in-flight runtime changes.
