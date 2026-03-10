# Identity Address Normalization

## Goal

Align CLI Base-only network normalization with the shared `wire` contract and remove repo-local duplication.

## Success Criteria

- CLI command and local-exec paths rely on shared `wire` network normalization.
- Tests lock the exact accepted aliases and rejection behavior.
- No extra local alias maps remain for the covered flows.

## Scope

- `src/commands/shared.ts`
- `src/wallet/local-exec.ts`
- matching tests/docs if needed

## Out Of Scope

- CLI auth token format changes.
- Non-normalization command UX changes.

## Risks / Constraints

- Preserve the existing Base-only error contract for unsupported networks.
- Keep local-exec behavior aligned with remote execution paths.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Current Status

- Shared Base-only normalization is cut over in `src/commands/shared.ts`.
- `pnpm build` and `pnpm typecheck` passed while validating against the local workspace `wire` build.
- Full `pnpm test` remains red because of unrelated existing failures in tool-execution, docs/Farcaster command flows, and other active workspace-cutover areas outside this normalization slice.
