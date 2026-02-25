Objective:
Perform a focused security review of a TypeScript Node.js CLI used by AI agents and automation.

Focus:
- Identify command-injection, shell-escaping, and unsafe subprocess invocation paths.
- Check path traversal and unsafe file read/write/delete behavior (especially user-controlled paths).
- Review secret handling: tokens/keys in logs, errors, telemetry, temp files, and process args.
- Validate trust boundaries for config, env vars, remote payloads, and stdin/stdout contracts.
- Find approval-bypass vectors, unsafe defaults, and destructive operations missing explicit safeguards.
- Inspect network request hardening: auth header handling, SSRF-like patterns, TLS/host assumptions.
- Verify failure-path behavior does not leak sensitive data or execute partial/unsafe side effects.

Output format:
- Findings ordered by severity (`high`, `medium`, `low`).
- For each finding include: `severity`, `file:line`, `issue`, `impact`, `recommended fix`.
- Include `Open questions / assumptions` only when required for correctness.
