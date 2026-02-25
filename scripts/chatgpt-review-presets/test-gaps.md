Objective:
Find the highest-risk missing tests for a TypeScript CLI and specify the minimal test set that would prevent regressions.

Focus:
- Prioritize gaps on modified/high-risk paths: auth, config loading, command parsing, transport, and error normalization.
- Target failure modes: network timeouts, malformed remote payloads, permission errors, and partial writes.
- Check contract tests for flags/options, exit codes, and stderr/stdout content under both success and failure.
- Find missing invariants around retries/idempotency and duplicate-run behavior.
- Verify tests cover secret redaction and sensitive output suppression.
- Flag brittle tests that assert incidental text instead of core contract invariants.

Output format:
- `High impact tests to add now` (max 8), each with:
  `priority`, `target file/suite`, `risk scenario`, `exact assertion/invariant`, `why high impact`.
- `Lower-priority follow-ups` (optional).
- `Open questions / assumptions` only when necessary.
