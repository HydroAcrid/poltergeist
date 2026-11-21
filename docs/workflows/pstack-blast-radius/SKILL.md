---
name: pstack-blast-radius
description: Investigate what a proposed code change could break beyond its diff and prove its critical safety assumptions. Use for an explicit blast-radius review or a consequential cross-boundary change; avoid speculative audits of trivial edits.
license: MIT
---

# Blast radius

Read the full change, relevant callers, project instructions and acceptance
criteria. Preserve unrelated work. This is an investigation within the requested
task, not permission to refactor adjacent systems or perform external actions.

Identify the one or two assumptions on which safety depends. Follow the actual
runtime path through pinned dependencies, scheduling/teardown, serialized data,
API consumers, persistence and other languages where relevant. Symbol search is
an entry point; inspect behavior across the boundary it cannot reveal.

Classify each concrete risk by trigger, consequence and evidence. Separate
confirmed risks from assumptions and cleared cases. Do not invent a caller,
report a search miss as proof of absence, or pad the report with hypothetical
failures. Trace history when it explains why the code is shaped this way.

Prove the critical assumption with the cheapest meaningful observation:

1. Cite the actual source/version and explain the path.
2. Run a focused script or test against the real implementation and assert the
   observable result. If regression protection is claimed, demonstrate the
   intended assertion failing under a representative isolated regression.
3. Reproduce the relevant user path when the risk depends on the running app.

Name exactly where evidence stops. Compilation and a persuasive explanation are
not runtime proof. Do not exercise production mutations or sensitive user data.
Use bounded independent review only when authorized and warranted by the risk;
no particular vendor, model, fan-out or nested agent session is required.

Report what changes, the critical assumption and proof, confirmed risks, cleared
cases, and the cheapest remaining check before release. Use file/line references
and actual results. Preserve the existing pre-flight/release requirements.

Adapted from Lauren Tan's pstack `blast-radius` under MIT; see `LICENSE` and
`upstream.json` for the pinned source.
