# 2026-03-02 - CLI Secret Provider Cutover (env/file/exec + SecretRef)

## Goal

Move CLI secret handling to SecretRefs with `env|file|exec` providers, using config metadata only for auth references and provider config.

## Scope

- Add secret provider contract/types and resolution runtime.
- Store PATs in secret providers (default file provider) instead of plaintext config.
- Store Farcaster signer private keys in secret providers (metadata-only signer file).
- Auto-migrate legacy plaintext config token + legacy signer files on read/use.
- Keep `~/.cobuild-cli/config.json` path and JSON compatibility.

## Constraints

- No `.env` file access.
- No token/header leaks in logs/output.
- Preserve existing command UX where practical (`setup`, `config set`, `farcaster signup/post`).
- Keep existing non-secret config metadata shape stable where possible.

## Planned File Touchpoints

- `src/types.ts`
- `src/config.ts`
- `src/commands/config.ts`
- `src/commands/setup.ts`
- `src/commands/farcaster.ts`
- `src/transport.ts`
- `src/usage.ts`
- `src/secrets/*` (new)
- `tests/config.test.ts`
- `tests/setup-security.test.ts`
- `tests/farcaster-command.test.ts`
- `tests/transport.test.ts`
- `tests/helpers.ts`
- Relevant architecture/security/product docs

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Completion workflow audit passes:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`
