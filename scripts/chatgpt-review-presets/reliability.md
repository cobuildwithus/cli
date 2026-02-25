Objective:
Audit reliability and operational safety for a TypeScript CLI running in unattended agent workflows.

Focus:
- Validate idempotency and retry safety for external side effects (APIs, filesystem, payments, state writes).
- Check timeout, backoff, and cancellation behavior for network/subprocess operations.
- Identify race conditions around temp files, lock files, concurrent runs, and shared cache directories.
- Ensure deterministic exit codes and stable stderr/stdout behavior under failure conditions.
- Review fallback logic for infinite retry loops, partial-state corruption, and stale-session handling.
- Confirm cleanup of temp artifacts and child processes on success, failure, and interruption.
- Verify cross-platform assumptions (macOS/Linux pathing, shell behavior, missing binaries) fail safely.

Output format:
- Findings ordered by severity (`high`, `medium`, `low`).
- For each finding include: `severity`, `file:line`, `issue`, `impact`, `recommended fix`.
- Include a short `Residual risk areas` section even if no findings are present.
