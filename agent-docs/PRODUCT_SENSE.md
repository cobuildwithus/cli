# Product Sense

## Core Product Expectations

- The CLI should make endpoint selection and auth state explicit, not implicit.
- Commands should optimize for fast diagnosis when user input or environment is invalid.
- Defaults should prioritize safe, predictable behavior over hidden automation.

## UX Contract

- Usage/help output should be sufficient to recover from common command errors.
- JSON output should be parseable and stable for downstream tooling.
- Network/API failures should include enough context (endpoint + short reason) for retries.

## Change Management Rules

- Treat command name/argument/output changes as product-contract changes.
- Update architecture + references docs when command routing or ownership shifts.
- Keep docs and command behavior synchronized in the same turn.
