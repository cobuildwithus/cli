# Revnet Issuance Terms Default Inputs

Status: active
Created: 2026-03-11
Updated: 2026-03-11

## Goal

- Keep `cli revnet issuance-terms` working with no arguments by documenting and testing the empty-input canonical tool call that now matches the `chat-api` contract.

## Success criteria

- CLI regression coverage proves the command can execute without `--project-id`.
- CLI docs/skill guidance explicitly reflect the default-project behavior.
- No changes are required to the existing canonical tool invocation shape beyond preserving omitted `projectId`.

## Scope

- In scope:
  - Add no-argument regression coverage for `revnet issuance-terms` in a standalone test file.
  - Update CLI-facing usage/skill docs to mention default-project behavior when `--project-id` is omitted.
  - Keep CLI guidance aligned with the canonical tool contract without touching files owned by other active ledger entries.
- Out of scope:
  - Changing revnet pay/cash-out/loan behavior.
  - Changing how the CLI discovers or authenticates canonical tools.

## Constraints

- Technical constraints:
  - Continue sending an empty tool input object when `projectId` is omitted.
  - Preserve existing output normalization for remote tool responses.
- Product/process constraints:
  - Keep `skills/cli/SKILL.md` synchronized because this command hits canonical tool execution.
  - Required repo verification and completion workflow audits still apply.

## Risks and mitigations

1. Risk: The CLI docs could still suggest that `--project-id` is the only supported path.
   Mitigation: Add a no-arg example and note the default-project behavior in the skill doc.

2. Risk: Future refactors could reintroduce `projectId` into the tool body as `undefined` or change the empty-input contract.
   Mitigation: Add a regression test that asserts the exact canonical tool execution body for the no-arg path.

## Tasks

1. Confirm the existing command path omits `projectId` when absent and preserve that behavior.
2. Add regression coverage for `cli revnet issuance-terms` with no arguments in an unowned test file.
3. Update usage/skill docs to show the default-project behavior.
4. Run required audits and verification, then close the plan.

## Decisions

- Preserve the existing empty-input CLI behavior and fix the upstream contract instead of inventing a CLI-side default.

## Verification

- Commands to run:
  - `pnpm build`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `bash scripts/check-agent-docs-drift.sh`
  - `bash scripts/doc-gardening.sh --fail-on-issues`
- Expected outcomes:
  - All commands pass and the new regression test shows an empty canonical tool input body for the no-arg command path.
