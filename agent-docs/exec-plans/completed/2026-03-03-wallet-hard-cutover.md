# Wallet Hard Cutover (2026-03-03)

## Goal

Hard-cutover CLI wallet architecture from payer-only local mode to wallet-level mode selection:
- `hosted`
- `local-generate`
- `local-key`

Local mode must support the same command capabilities as hosted for:
- `wallet`
- `send`
- `tx`
- `farcaster signup`
- `farcaster post`

## Constraints

- No backward-compat shim unless explicitly requested.
- Preserve existing in-flight OAuth/PKCE edits; do not revert unrelated dirty worktree state.
- Consolidate reusable logic into `../wire` where practical.
- Keep config compatibility expectations for existing fields while introducing wallet-mode config.

## Approach

1. Add/revise shared wire contracts/utilities for wallet-mode and local EVM execution validation/planning.
2. Introduce CLI wallet backend abstraction (hosted vs local) with command-facing parity behavior.
3. Replace payer-only setup/command surface with wallet-level initialization/status semantics.
4. Route send/tx/farcaster flows through the wallet backend abstraction.
5. Add/adjust tests for hosted/local parity and non-interactive local setup semantics.
6. Update docs/usage/help text to new hard-cutover surface.
7. Run completion workflow and required checks, then commit exact touched files.

## Risks

- Active edits overlap in setup/oauth command files.
- Idempotency behavior divergence between hosted API and local execution paths.
- Farcaster signup assumptions currently rely on hosted backend smart account and policy gate.

## Mitigations

- Keep diffs narrow and behaviorally explicit with focused test coverage.
- Reuse `wire` contracts for typed-data, parsing/normalization, and call-planning.
- Preserve existing output schema where possible; document intentional contract breaks.
