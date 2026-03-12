# 2026-03-12 CLI Simplification Batch

## Goal

Land the highest-value behavior-preserving simplifications that are safe within current ownership boundaries by deduping the `send`/`tx` single-request execution path and the shared Revnet write-command scaffolding.

## Scope

- Extract shared helpers for JSON input validation and single wallet-backed hosted/local execution used by `send` and `tx`.
- Extract shared participant-command validators used by unowned `flow` and `governance` command families.
- Extract low-risk reusable Incur command-wrapper helpers for unowned `config`, `farcaster`, and `wallet` command modules.
- Refactor Revnet write commands to share execution-context resolution, dry-run rendering, and final output shaping.
- Add or adjust focused regression tests for the refactored command paths.

## Out Of Scope

- `src/cli-incur.ts` command metadata / argv normalizer cleanup.
- `src/commands/terminal-funding-shared.ts` simplification.
- `src/commands/protocol-budget-maintenance/**` executor consolidation.
- Active stake command files currently owned by another session.

## Constraints

- Preserve command behavior and output contracts.
- Respect active ownership boundaries recorded in `COORDINATION_LEDGER.md`.
- Keep `send`/`tx` on the existing raw `/api/cli/exec` wallet path.
- Keep Revnet using the existing hosted/local raw tx execution path.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed on 2026-03-12.
- Ownership-blocked audit items in this turn: `src/cli-incur.ts`, `src/commands/terminal-funding-shared.ts`, and `src/commands/protocol-budget-maintenance/**`.
- Verification complete: `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all passed after adding focused coverage for `participant-input-validation`.

## Decisions

- Treat audit items blocked by active ownership as explicit follow-up debt for this turn instead of colliding with in-flight work.
- Prefer new command-local shared helpers over widening refactors into owned command-registration files.
- Keep the completion audit same-agent after worker-based audit attempts proved unreliable for concise review-only passes in this tree.
Status: completed
Updated: 2026-03-12
Completed: 2026-03-12
