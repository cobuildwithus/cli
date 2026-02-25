# Build Bot CLI Behavior

## Contract Surface

- `buildbot` command output should remain deterministic for equivalent inputs.
- Command failures should return actionable error messages with usage context.
- JSON output modes should preserve stable keys and avoid ambiguous value types.

## Endpoint Routing Expectations

- Commands that target interface endpoints must not silently switch to chat-api endpoints.
- Commands that target chat-api endpoints must explicitly route there via transport configuration.
- Configuration output must make endpoint assignments visible to users.

## Configuration Expectations

- Config writes should preserve `~/.cobuild-cli/config.json` compatibility.
- Missing required auth/config values should fail fast with precise remediation guidance.
- New config keys should be reflected in command help and docs in the same change set.

## Change Management

- Treat command signature or output-shape changes as contract changes.
- Update `agent-docs/references/cli-command-and-data-flow.md` when command topology changes.
- Update `agent-docs/references/module-boundary-map.md` when data-flow ownership changes.
