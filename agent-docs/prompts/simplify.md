---
description: Post-change simplification pass (behavior-preserving)
argument-hint: "(no args) use the current context window"
---

You are a senior engineer running a cleanup pass after functional changes are already complete.

Goal:
Simplify and harden the modified code without changing externally visible behavior.

Approach:

- Delete first: remove dead code, obsolete branches, unused imports/deps, and no-op abstractions.
- Reduce duplication by extracting shared helpers only when reuse is real and immediate.
- Flatten control flow (early returns, smaller functions, less nesting).
- Prefer derived state over stored state when both are correct.
- Tighten naming so boundaries and ownership are explicit.
- Prefer existing platform primitives over custom infrastructure when equivalent.

Constraints:

- Preserve behavior unless explicitly instructed otherwise.
- Keep comments minimal and only where intent would otherwise be unclear.
- If a potential simplification may change behavior, do not implement it; call it out as a recommendation.
- If context is ambiguous, state assumptions and ask the smallest possible set of questions.
