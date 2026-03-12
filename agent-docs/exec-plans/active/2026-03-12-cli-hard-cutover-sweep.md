# 2026-03-12 CLI Hard Cutover Sweep

## Goal

Finish the remaining CLI cutover work called out in review by collapsing the duplicate execution/runtime seams and making command introspection match the real command surface.

## Scope

- Unify terminal-funding and budget-maintenance execution on the shared protocol-plan runner.
- Move schema metadata ownership next to command registration instead of maintaining a central string-keyed map.
- Hard-cut `wallet` into real `wallet status` and `wallet init` subcommands.
- Centralize configured wallet-context resolution under `src/wallet/payer-config.ts`.
- Remove duplicate send/tx execution scaffolding with a shared wallet-write command helper.
- Update affected tests and durable CLI docs/skill guidance.

## Constraints

- Hard cut only; do not preserve the old `wallet` leaf compatibility path.
- Preserve current hosted batch semantics for structural protocol plans and hosted sequential raw-tx semantics for terminal funding, budget maintenance, revnet, send, and tx.
- Keep deterministic idempotency, dry-run output, and replay-safe failure messages stable.
- Do not revert unrelated dirty worktree changes outside the files this cutover touches.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Notes

- Review notes referencing unfinished terminal-funding and budget-maintenance wrapper migration are now resolved by the shared protocol-plan runner `raw-tx` path.
- Schema metadata ownership now lives next to command registration so mutating budget subcommands no longer fall back to default read-only metadata.

## Status

completed
