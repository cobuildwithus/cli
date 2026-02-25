# AGENTS.md

## Purpose

This file is the routing map for agent work in this repository.
Durable guidance lives in `agent-docs/`.

## Precedence

1. Explicit user instruction in the current chat turn.
2. `Hard Rules (Non-Negotiable)` in this file.
3. Other sections in this file.
4. Detailed process docs under `agent-docs/**`.

If instructions still conflict after applying this order, ask the user before acting.

## Read Order

1. `agent-docs/index.md`
2. `ARCHITECTURE.md`
3. `agent-docs/cli-architecture.md`
4. `agent-docs/RELIABILITY.md`
5. `agent-docs/SECURITY.md`
6. `agent-docs/references/module-boundary-map.md`
7. `agent-docs/references/cli-command-and-data-flow.md`
8. `agent-docs/references/testing-ci-map.md`

## Hard Rules (Non-Negotiable)

- Never access `.env` or `.env*` files.
- Never print or commit full PAT tokens or raw `Authorization` headers.
- Keep CLI config in `~/.cobuild-cli/config.json` and preserve file format compatibility.
- Use a hard cutover approach and never implement backward compatibility unless explicitly asked.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable snapshots.
- Always keep `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` current for every coding task (single-agent and multi-agent): claim scope before first edit, list planned symbol add/rename/delete work, and remove your entry when done.
- Any spawned subagent that may review or edit code must read `COORDINATION_LEDGER.md` first and must not touch files or symbols owned by another active entry.
- Run completion workflow audit passes (`simplify`, `test-coverage-audit`, `task-finish-review`) for every non-doc change that touches production code or tests; skip only when the user explicitly says to skip for that turn.
- Docs/process-only changes skip completion workflow audit passes unless the user explicitly asks to run them.
- Keep this file short and route-oriented; move durable detail into `agent-docs/`.

## How To Work

- Before implementation, do a quick assumptions check. Ask only for high-impact clarifications (scope, security invariants, external API behavior).
- Continue working in the current tree even when unrelated external dirty changes appear.
- Do not pause or block progress solely because the worktree is dirty; treat out-of-scope changes as context unless they conflict with a listed hard rule.
- If unexpected commits or unrelated file changes appear mid-task, continue from current `HEAD` by default and only pause when a listed hard rule is at risk or the user asks you to stop.
- Never revert, delete, or rewrite existing edits you did not make unless the user explicitly asks.
- If unrelated breakage appears in files you did not touch, keep working on your scoped changes; only take ownership of fixing it when your edits caused it or the user explicitly asks.
- If you generate temporary files for testing/exploration (for example scratch outputs or local metadata), remove them before handoff unless the user asked to keep them.
- Do not introduce "break now, fix later" phases.
- For coding tasks, follow the COORDINATION_LEDGER hard rule above (including required row fields and lifecycle updates).
- When a change can affect compilation (shared types, signatures, interfaces, schema/import boundaries), update all impacted call sites in the same change set so the tree stays compiling.
- When architecture-significant behavior changes, update matching docs in `agent-docs/`.
- For multi-file or high-risk work, add an execution plan in `agent-docs/exec-plans/active/`.

## Commit and Handoff

- Same-turn task completion = acceptance, unless the user explicitly says `review first` or `do not commit`.
- If you changed files and required checks are green, you MUST run `scripts/committer "type(scope): summary" path/to/file1 path/to/file2` before sending final handoff.
- Do not end with "ready to commit" or "commit pending"; perform the commit in the same turn.
- Use `scripts/committer` only (no manual `git commit`).
- Agent-authored commit messages should use Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`).
- If no files changed, do not create a commit.
- Commit only exact file paths touched in the current turn.
- Do not skip commit just because the tree is already dirty.
- If a touched file already had edits, still commit and explicitly note that in handoff.
- On commit failure, report the exact error and retry with the appropriate fix (`--force` for stale lock, rerun after branch moved, fix Conventional Commit message, etc.).

## Required Checks

- Always run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- For docs/process-only updates, also run:
  - `bash scripts/check-agent-docs-drift.sh`
  - `bash scripts/doc-gardening.sh --fail-on-issues`

## Completion Workflow

- For any non-doc change that touches production code or tests, run this full workflow before final handoff.
- Skip this workflow for docs/process-only turns unless the user explicitly asks for the full audit sequence.
- For changes that require this workflow: run a simplification pass using `agent-docs/prompts/simplify.md`.
- Apply behavior-preserving simplifications identified in that pass.
- Then run a test-coverage audit pass using `agent-docs/prompts/test-coverage-audit.md` with full change context.
- The test-coverage audit subagent should implement the highest-impact missing tests it identifies (especially edge cases, failure modes, and invariants) before handoff.
- Re-run required checks after the simplify + test-coverage sequence (even if no new tests were added).
- Then run a completion audit using `agent-docs/prompts/task-finish-review.md` with full change context.
- Final handoff remains gated on green required checks; completing audits does not waive verification requirements.
- Do not skip these audit passes unless the user explicitly instructs skipping them for that turn.
- When using a fresh subagent for coverage or completion audits, provide an audit handoff packet that includes:
- what changed and why (behavior-level summary, not just filenames)
- expected invariants/assumptions that must still hold
- links to active execution-plan docs under `agent-docs/exec-plans/active/` (when present)
- verification evidence already run (commands + pass/fail outcomes)
- current git worktree context (relevant modified files, known unrelated dirty paths, and review scope boundaries)
- explicit instruction to read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` and respect active ownership boundaries
- Instruct the reviewer to use the handoff packet plus current `git diff`/call-path inspection; do not rely on diff-only inference.
- During simplify/test-coverage/completion-audit passes, never overwrite, discard, or revert existing worktree edits (including unrelated dirty files) and never use reset/checkout-style cleanup commands.
- If a suggested audit change collides with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Always prefer a fresh subagent for coverage and completion audits; only fall back to same-agent audit when subagent execution is unavailable.
- Resolve high-severity findings before final handoff; document any deferred risks.

## Notes

- `agent-docs/index.md` is the canonical docs map. Update it whenever docs move or change.
