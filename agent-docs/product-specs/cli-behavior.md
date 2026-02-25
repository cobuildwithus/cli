# CLI Behavior

## Contract Surface

- `cli` command output should remain deterministic for equivalent inputs.
- Command failures should return actionable error messages with usage context.
- JSON output modes should preserve stable keys and avoid ambiguous value types.

## Endpoint Routing Expectations

- Command transport must always resolve against configured interface API base URL.
- `docs` and `tools` must use interface routes with unchanged path names (`/api/docs/search`, `/api/buildbot/tools/*`).
- Configuration output must only expose interface routing state.

## Configuration Expectations

- Config writes should preserve `~/.cobuild-cli/config.json` compatibility.
- Missing required auth/config values should fail fast with precise remediation guidance.
- New config keys should be reflected in command help and docs in the same change set.

## Change Management

- Treat command signature or output-shape changes as contract changes.
- Update `agent-docs/references/cli-command-and-data-flow.md` when command topology changes.
- Update `agent-docs/references/module-boundary-map.md` when data-flow ownership changes.
