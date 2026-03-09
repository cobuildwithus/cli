# 2026-03-09 - Incur 0.3 Upgrade

## Goal
Upgrade the CLI from `incur@0.1.17` to the current published `incur@0.3.0`, preserve existing runtime behavior, and adopt the highest-value new upstream global features where they improve operator and agent UX.

## Success Criteria
- Dependency is updated to `incur@0.3.0`.
- CLI runtime remains compatible with existing command surfaces and tests.
- Custom manifest/schema logic uses the new upstream `--llms-full` contract instead of the compact `--llms`.
- Leading-global preprocessing recognizes newly available Incur globals that users may place before a command.
- Docs and `skills/cli/SKILL.md` explain the new recommended discovery/introspection/output-filtering flows.
- Required checks and completion workflow audit passes are green.

## Scope
- Dependency bump and lockfile refresh.
- Runtime compatibility changes in the Incur integration layer.
- Test updates for manifest loading and new global flag handling.
- User-facing docs for new Incur features relevant to this CLI.

## Non-Goals
- Changing this CLI's existing command contracts beyond what is necessary for the Incur upgrade.
- Release/publish/version-tag flows for this repository.
- Large refactors unrelated to the Incur upgrade.

## Risks / Constraints
- `incur@0.3.0` changes `--llms` semantics; any code assuming full manifest output will break unless updated.
- Preprocessing logic currently hardcodes known global flags and could reject or mis-handle new upstream globals when used before commands.
- Must preserve setup/config/security behavior and avoid any secret-handling regressions.

## Verification
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Completion workflow audit passes: simplify, test-coverage-audit, task-finish-review
Status: completed
Updated: 2026-03-08
Completed: 2026-03-08
