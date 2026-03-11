Goal
- Make `cli farcaster signup` automatically persist the resulting wallet link in Cobuild after both hosted and local signup success.

Constraints/Assumptions
- The CLI should call chat-api for the new sync step so agent-authenticated runtime writes live behind the canonical `/v1` boundary.
- Onchain signup success cannot be rolled back if the sync step fails.

Key decisions
- Reuse the existing signup success payload (`fid`, `custodyAddress`) and perform a follow-up authenticated `/v1` sync call from the CLI.
- Treat sync failures as partial failures with explicit output instead of masking them.

State
- Done: confirmed transport routes `/v1/*` to `chatApiUrl`.
- Done: implemented the post-signup sync helper in the `src/commands/farcaster.ts` wrapper without touching planner-owned signup files.
- Done: verified with `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Now: none.
- Next: none.
