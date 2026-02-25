# Module Boundary Map

## Core Boundaries

### CLI composition boundary

- Paths: `src/index.ts`, `src/cli.ts`
- Responsibility: command parsing, usage/help, handler dispatch, result/error output.
- Rule: keep handler orchestration explicit; avoid hidden side effects across handlers.

### Local config boundary

- Path: `src/config.ts`
- Responsibility: config path resolution, JSON persistence, required field enforcement.
- Rule: only config helpers read/write config file; command handlers consume helper APIs.

### Network transport boundary

- Path: `src/transport.ts`
- Responsibility: endpoint normalization, POST request dispatch, response normalization.
- Rule: command handlers should not construct fetch calls directly, and transport resolves requests against the interface base URL only.

### Governance tooling boundary

- Paths: `scripts/**`, `agent-docs/**`
- Responsibility: docs drift enforcement, docs inventory/report generation, plan lifecycle.
- Rule: tooling scripts should remain shell-portable and repository-root relative.

## Dependency Direction Rules

1. Command handlers may depend on config helpers and transport helpers.
2. Config helpers must not depend on command-specific handler behavior.
3. Transport helpers may depend on config helpers but not on command parsing internals.
4. Documentation/governance scripts must not modify runtime CLI behavior.

## Cross-Cutting Invariants

1. Secrets are never printed in full in normal output paths.
2. Endpoint and payload contracts remain explicit and centralized.
3. Errors are normalized to bounded user-visible messages.
4. Architecture-sensitive code changes are paired with docs updates or an active plan.

## Update Rule

If boundaries or dependency directions change, update this file alongside `ARCHITECTURE.md` and `agent-docs/cli-architecture.md`.
