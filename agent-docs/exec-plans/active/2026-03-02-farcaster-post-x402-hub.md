# 2026-03-02 - CLI Farcaster post via Neynar Hub + x402

## Goal
Expand Farcaster posting to support per-agent x402 payer setup and runtime selection:
- hosted backend signing (`/api/buildbot/farcaster/x402-payment`), and
- local signer-based `X-PAYMENT` construction without backend signing.

## Scope
- Add `cli farcaster x402 init` and `cli farcaster x402 status`.
- Add per-agent payer config at `~/.cobuild-cli/agents/<agent>/farcaster/x402-payer.json`.
- Add per-agent local payer secret contract and storage via SecretRef.
- Route `farcaster post` by payer mode (`hosted` vs `local`).
- Keep direct Neynar hub submit for post (`/v1/submitMessage`) with single-use payment retry on 402.
- Add verify mode enum: `none` (default), `once` (`--verify` shortcut), `poll`.
- Add signup follow-up payer setup behavior when payer config is missing.

## Non-Goals
- Secret-storage redesign.
- Embed/mention/reply support (text-only MVP).
- Hub URL override.

## Risks / Constraints
- Must not leak signer private key or PAT.
- Must preserve existing `farcaster signup` behavior.
- x402 payment headers are single-use; retries must mint a fresh header.
- Local payer mode must not call backend x402 signing routes.

## Verification
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
