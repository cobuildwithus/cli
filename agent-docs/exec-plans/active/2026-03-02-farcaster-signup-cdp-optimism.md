# 2026-03-02 - CLI Farcaster signup via CDP Smart Account (Optimism)

## Goal
Add `cli farcaster signup` that triggers protocol-native Farcaster signup/signer-registration through the interface build-bot backend while generating and storing the Ed25519 signer key locally in the CLI environment.

## Scope
- Add new CLI command path and usage docs.
- Add local Ed25519 key generation + secure file persistence.
- Call new interface endpoint for Farcaster signup using existing build-bot auth.
- Handle already-registered FID as a graceful CLI error.

## Non-Goals
- Message broadcast/posting integration.
- Multi-network support (Optimism only for this flow).

## Risks / Constraints
- Must not leak private key material to stdout/stderr.
- Must preserve existing CLI command behavior.
- Must align request/response contract with interface implementation.

## Verification
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
