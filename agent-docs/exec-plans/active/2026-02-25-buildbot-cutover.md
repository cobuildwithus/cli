# 2026-02-25 Buildbot Cutover Plan

## Goal
Complete a hard cutover from legacy hyphenated naming to `cli` across runtime code, tests, scripts, skill packaging, and docs, while improving README onboarding clarity for agent-skill setup.

## Scope
- Replace legacy hyphenated literals with `cli` naming in tracked source/docs/scripts.
- Rename skill package path and metadata to `cli`.
- Update tests to cover renamed API/config/callback path invariants.
- Rewrite README to provide explicit install/setup/skill-onboarding steps.

## Constraints
- Respect AGENTS hard rules, including immutable completed exec plans.
- Preserve CLI behavior except explicit hard cutover naming changes.
- Run completion workflow audits and required verification commands.
- Never expose PAT secrets in output/docs.

## Work Breakdown
1. Inventory and apply literal/path renames.
2. Update skill path metadata and README onboarding content.
3. Add/adjust tests for renamed route/path contracts.
4. Run simplify + coverage audit + completion audit workflow.
5. Run required verification and governance checks, then commit.

## Success Criteria
- No remaining legacy hyphenated literals outside immutable completed plan snapshots.
- README is clear for agent-skill setup from local checkout and GitHub installation.
- Required checks and audit workflow complete with green results.
