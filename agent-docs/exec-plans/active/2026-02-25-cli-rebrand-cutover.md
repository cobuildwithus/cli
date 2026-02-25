# CLI Rebrand Cutover

Status: completed
Created: 2026-02-25
Updated: 2026-02-25

## Goal

Hard-cutover product naming from Build Bot/buildbot to CLI before npm publish and repository migration.

## Success criteria

- npm package name is `@cobuild/cli`.
- User-facing command references use `cli` (no buildbot command references remain in runtime/help/docs/tests).
- Local config path is `~/.cobuild-cli/config.json`.
- Skill packaging and references move from `skills/buildbot-cli` to `skills/cli`.
- Required checks pass.

## Constraints

- Keep interface API route contracts unchanged (`/api/buildbot/*`) unless explicitly requested.
- No backwards-compat aliases unless explicitly requested.
- Preserve existing release hardening behavior and checks.

## Scope

- Runtime strings/usages in `src/**`.
- Package/bin metadata in `package.json` + lockfile updates.
- Tests, docs, and skills updates needed for cutover consistency.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`

## Outcome

- Completed on 2026-02-25 with CLI branding cutover, release guard updates, and required verification checks green.
