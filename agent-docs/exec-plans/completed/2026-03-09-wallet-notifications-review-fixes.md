# Wallet Notifications Review Fixes

## Goal

Close the wallet notifications review findings that affect CLI input validation and command ergonomics.

## Scope

- Align local validation with server limits where it is safe to do so.
- Add regression coverage for cursor length and related request-shape behavior.

## Constraints

- Keep the command under `tools notifications list`.
- Do not duplicate server business logic beyond lightweight input validation.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

