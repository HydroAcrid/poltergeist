---
name: pstack-correct
description: Prevent recurring agent mistakes by turning observed failure patterns into structural constraints and proven checks. Use when the user requests this or the same documented mistake recurs; a one-off correction does not justify a repository-wide policy change.
license: MIT
disable-model-invocation: true
---

# Prevent repeat mistakes

Read applicable project/vault instructions, relevant user corrections, reverts,
review findings and failing cases. Use the recent bounded evidence needed for the
current task. Do not mine unrelated chat archives or reinterpret agent-generated
text as a human preference. Installation does not authorize broad repo changes.

Group repeated failures by mechanism. Treat two observed instances as a recurring
class; describe a single incident honestly. Distinguish a task-specific demand
from a lasting engineering constraint. Prioritize concrete consequences rather
than stylistic disagreement, and stay within the authorized milestone.

Choose the smallest effective enforcement at the highest appropriate level:

1. **Structure:** one owner for mutable state, one source of truth, or an existing
   supported path that removes the unsafe alternative.
2. **Types and boundaries:** represent the invariant and validate external input.
3. **Lint or executable guard:** detect the specific bad pattern and make its
   failure explain how to repair it. Avoid a blanket validator or unrelated sweep.
4. **Behavior test:** assert the result a user observes, including the failure
   path that escaped earlier checks.
5. **Instructions:** reserve prose for judgment that cannot be encoded reliably.

Prove each new guard against a real past failure or a faithful isolated
reproduction, then restore and show the good case passes. Ensure the project's
actual runner selects the check; a standalone test absent from normal execution
protects nothing. Do not weaken established checks or rewrite unrelated history.

If a durable rule is needed, keep a small mapping of rule, enforcing mechanism,
and evidence in the project's established instruction/runbook location. Explain
scope and justified exceptions; use existing project approval rules rather than
inventing another approval process. Remove redundant rules once the unsafe state
cannot occur. Preserve the project's independent pre-flight gate for release.

Report the observed failure class, chosen enforcement, failing/restored evidence,
and remaining limits. If no repeated mechanism is supported, fix the requested
incident without manufacturing a new policy.

Adapted from Lauren Tan's pstack `correct` under MIT; see `LICENSE` and
`upstream.json` for the pinned source.
