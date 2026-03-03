# Security

## Hard Constraints

- Never access `.env` or `.env*` files.
- Never print full PATs, bearer headers, or raw secret-bearing config blobs.
- Validate/normalize CLI inputs before building API payloads.
- Keep unauthorized/error outputs bounded and non-sensitive.

## Trust Boundaries

1. Terminal input boundary

- User-provided argv values can be malformed or hostile.

2. Local storage boundary

- `~/.cobuild-cli/config.json` contains auth/provider metadata and secret references.
- `~/.cobuild-cli/secrets.json` (default file provider) contains secret values when file-backed storage is used.
- Config writes should use private dir/file modes (`0700`/`0600`) when supported.
- Config writes should attempt post-write permission tightening (`chmod`) for dir/file best-effort hardening.

3. Network boundary

- HTTP calls to interface `/api/cli/*` endpoints are privileged operations.

4. Remote service boundary

- Interface API and downstream execution engines are external trust domains.

## Security-Critical Paths

- `src/config.ts`:
  - `readConfig` / `writeConfig`
  - `requireConfig`
- `src/transport.ts`:
  - `apiPost`
- `src/commands/config.ts`:
  - `handleConfigCommand` (`show` masking behavior)
- `src/cli.ts`:
  - `runCliFromProcess` (bounded error output + non-zero exit)

## Defensive Rules

- Keep token masking in `config show` output.
- Prefer setup token prompt (hidden input) over shell arguments when interactive.
- Prefer `--token-file` / `--token-stdin` over `--token` in non-interactive automation.
- Keep signer private keys out of Farcaster signer metadata files; store signer secrets via SecretRef providers.
- Avoid logging raw request bodies when they may include sensitive values.
- Keep endpoint/path construction centralized to reduce injection mistakes.
- Fail closed on malformed required inputs.
- Reject insecure non-loopback transport URLs before sending bearer tokens.
- Reject caller-provided transport headers that attempt to override reserved auth/content headers.
- Keep server-originated error output bounded and control-character-sanitized.

## Current Watchlist

1. Ensure future debug logging does not leak auth headers.
2. Ensure config migrations preserve secure file permissions and masking behavior.
3. Keep error surfaces consistent when interface API contracts evolve.

## Escalation

Escalate to humans for:

- auth model or PAT handling changes,
- wallet execution permission model changes,
- new external trust boundaries,
- changes affecting secret storage guarantees.
