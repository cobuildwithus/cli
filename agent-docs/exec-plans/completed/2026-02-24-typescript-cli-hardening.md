# Migrate CLI to TypeScript with tests and coverage gates

Status: completed
Created: 2026-02-24
Updated: 2026-02-24

## Goal

- Deliver a production-grade TypeScript CLI architecture with composable modules, strong automated tests, and enforced coverage gates aligned with `../interface` testing posture.

## Success criteria

- CLI command surface still works (`config`, `wallet`, `send`, `tx`) with backward-compatible config path/shape.
- Source is TypeScript-first with runtime entrypoint emitted to `dist/`.
- Vitest test suite covers command parsing, payload contracts, error handling, and config behavior.
- Coverage thresholds are enforced (per-file; lines/functions/statements >=85%, branches >=80%).
- Required checks pass: `pnpm typecheck` and `pnpm test`; coverage gate command passes.

## Scope

- In scope:
- Convert runtime source from JS to TS and split into focused modules.
- Add test framework and coverage config plus relevant tests.
- Update package scripts/bin wiring and docs for TS workflow.
- Out of scope:
- Adding new remote API endpoints.
- Changing auth model, config file location, or token storage format.

## Constraints

- Technical constraints:
- Must preserve `~/.build-bot/config.json` compatibility.
- Must not leak PAT tokens in normal output.
- Product/process constraints:
- Follow AGENTS required verification and completion workflow.

## Risks and mitigations

1. Risk: Refactor changes command behavior subtly.
   Mitigation: Add high-signal tests for payload and usage/error contracts before/alongside refactor.
2. Risk: Coverage gates become noisy/fragile.
   Mitigation: Keep module boundaries small and test file-level behavior directly.

## Tasks

1. Completed: Create modular TS structure for command handlers, config, transport, and utilities.
2. Completed: Wire CLI entrypoint and package scripts to build/run TS output.
3. Completed: Configure Vitest + coverage thresholds matching interface style.
4. Completed: Add targeted unit tests for happy paths and failure paths.
5. In progress: Run required checks and completion audits; fix any high-severity findings.

## Decisions

- Use Vitest with V8 coverage provider and per-file thresholds to mirror `../interface`.
- Split CLI logic into multiple modules to improve composability and testability.
- Add GitHub Actions workflow (`.github/workflows/test-and-coverage.yml`) to gate typecheck, test, and coverage on PR/push.

## Verification

- Commands to run:
- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- TypeScript compiles cleanly.
- Tests pass with coverage thresholds met.
Completed: 2026-02-24
