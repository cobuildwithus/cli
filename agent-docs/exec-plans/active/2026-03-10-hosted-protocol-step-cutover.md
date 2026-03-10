# 2026-03-10 Hosted Protocol Step Cutover

## Goal

Retarget hosted protocol writes in the CLI to the shared `protocol-step` execution contract, including the single-step `goal create` path.

## Scope

- Preserve protocol-step semantics in hosted dry runs and live requests.
- Switch the shared protocol-plan runner off the generic hosted `tx` envelope.
- Route `goal create` through the same hosted protocol-step contract.
- Update CLI tests for the new request bodies and response kinds.

## Constraints

- Keep local wallet execution on the current local tx path.
- Preserve idempotency key derivation, resume behavior, and receipt decoding.
- Avoid overlapping with the separately owned participant-command wrapper cutover files.

## Planned Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed on 2026-03-10.
- Hosted protocol-plan execution now preserves shared protocol semantics instead of flattening to raw `tx`.
- Hosted `goal create` now uses the same shared `protocol-step` contract, while local wallet execution stays on the raw-tx path.
- Verification passed: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, `pnpm verify`.
