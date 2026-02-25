# 2026-02-25 Interface Routing Cutover Plan

## Goal
Hard-cutover BuildBot CLI so docs/tools (and all command transport routing) use only the interface API base URL, with no direct chat-api URL configuration or endpoint targeting.

## Scope
- Remove chat-target endpoint routing from transport/config interfaces.
- Remove chat-api URL derivation, defaults, persisted config field, and env/flag handling.
- Update command usage/help/setup/config output to interface-only routing contract.
- Update tests to enforce no chat endpoint target path.
- Update skill and architecture/product/reference docs to reflect the new boundary.

## Constraints
- Respect active ownership boundaries in `COORDINATION_LEDGER.md`.
- Do not introduce backward compatibility shims for removed chat-api flags/env/config.
- Keep config format compatibility where safe while enforcing hard cutover behavior.
- Run completion workflow audit passes plus required verification checks.

## Work Breakdown
1. Audit runtime references to chat endpoint target and chat-api config surfaces.
2. Apply code changes in transport/config/commands/usage for interface-only routing.
3. Update tests for transport selection, setup/config behavior, and help output.
4. Update `skills/buildbot-cli/SKILL.md` routing guidance and relevant docs.
5. Run simplify -> test-coverage-audit -> task-finish-review.
6. Run required checks, commit scoped files, and remove ledger entry.

## Success Criteria
- No runtime code path can route API calls to a chat endpoint target.
- CLI no longer accepts/persists/displays `chatApiUrl` or `--chat-api-url`.
- Env handling no longer reads `BUILD_BOT_CHAT_API_URL`.
- Docs/tools commands still hit the same API paths via interface base URL.
- Tests and required checks pass, and docs/skill routing guidance matches implementation.

## Status
- Completed on 2026-02-25 with required checks and completion workflow audit passes green.
