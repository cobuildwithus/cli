Objective:
Review CLI contract quality for agent-driven usage, prioritizing predictability, composability, and automation safety.

Focus:
- Check command/flag parsing for ambiguity, surprising precedence, and unsafe shorthand behavior.
- Validate that required inputs are enforced and invalid combinations fail early with actionable errors.
- Ensure machine-usable outputs are stable: no accidental human text in parse-critical outputs.
- Verify consistent exit-code semantics (`0` success, non-zero failure) across all command paths.
- Review help/usage accuracy versus actual runtime behavior and defaults.
- Identify interactive prompts that can block non-interactive agent execution.
- Confirm backward-incompatible behavior changes are explicit and documented.
- Flag command names/options that create high misuse risk or silent no-op behavior.

Output format:
- Findings ordered by severity (`high`, `medium`, `low`).
- For each finding include: `severity`, `file:line`, `issue`, `impact`, `recommended fix`.
- Include a `Most likely operator mistakes` section with 3 concrete misuse scenarios.
