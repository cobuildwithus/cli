# CLI Behavior

## Contract Surface

- `cli` command output should remain deterministic for equivalent inputs.
- Command failures should return actionable error messages with usage context.
- JSON output modes should preserve stable keys and avoid ambiguous value types.

## Endpoint Routing Expectations

- Command transport must resolve `/v1/*` against configured Chat API base (`chatApiUrl` when set, fallback `url`) and non-`/v1/*` paths against interface base (`url`).
- `docs` and `tools` must execute canonical chat-api tool routes (`GET /v1/tools` as needed, `POST /v1/tool-executions`).
- When canonical `/v1/*` routes are unavailable, `docs`/`tools` must fail with explicit routing guidance (`--chat-api-url` or edge route `/v1/*` to Chat API) instead of generic 404-only errors.
- Configuration output must expose both interface and chat-api routing state.

## Configuration Expectations

- Config writes should preserve `~/.cobuild-cli/config.json` compatibility.
- Config should store auth/provider metadata and secret references (not plaintext PAT/signer private keys).
- Missing required auth/config values should fail fast with precise remediation guidance.
- New config keys should be reflected in command help and docs in the same change set.

## Change Management

- Treat command signature or output-shape changes as contract changes.
- Update `agent-docs/references/cli-command-and-data-flow.md` when command topology changes.
- Update `agent-docs/references/module-boundary-map.md` when data-flow ownership changes.
