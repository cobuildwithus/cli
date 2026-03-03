## Goal

Add a dedicated Chat API base URL to CLI config so canonical `/v1/*` routes do not depend on Interface URL routing.

## Constraints

- Keep wallet/send/tx/farcaster endpoint behavior unchanged (`/api/buildbot/*` stays on interface URL).
- Keep PAT auth model unchanged (single bearer token resolution).
- Avoid legacy `/api/buildbot/tools/*` and `/api/docs/search` runtime fallback.
- Keep config format compatible with existing installs.

## Planned Changes

1. Add `chatApiUrl` to persisted config/type surfaces.
2. Add `--chat-api-url` to `setup` and `config set`.
3. Route `/v1/*` through `chatApiUrl` (fallback to `url` when absent).
4. Remove deprecated `chatApiUrl`-stripping behavior and update tests/docs.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audits: simplify, test-coverage-audit, task-finish-review
