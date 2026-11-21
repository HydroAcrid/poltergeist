---
name: pstack-benchmark-checklist
description: Review whether a performance, latency, throughput or token-efficiency claim is supported by a meaningful benchmark. Use before reporting or acting on a measured improvement; this does not authorize paid experiments or changing frozen evaluation data.
license: MIT
---

# Review benchmark evidence

Read the proposed claim and measurement code before interpreting its numbers.
Consult project/vault evaluation rules. Preserve frozen datasets, labels, holdout
boundaries, model/runtime bindings and existing promotion gates. Do not launch
paid/provider work, expand data access, or change calibration without the user's
authorization. Use existing evidence and cheap local checks first.

For a requested rough estimate, one run may suffice if labeled as such; still
verify correctness and that the work occurred. A consequential choice between
options needs a fair comparison, not an estimate relabeled as a conclusion.

Check these points with evidence:

1. **Limiter:** identify CPU, I/O, network, scheduling or provider constraints.
   Use a separate profiling run where needed; do not report instrumented timing
   as ordinary runtime. If no limiter is established, narrow the conclusion.
2. **Fair configuration:** use relevant production settings, versions, batching,
   concurrency, data sizes, model settings and budgets on both sides. Disclose
   unequal tuning, warm/cold cache, setup and machine load.
3. **Plausibility:** reconcile bytes, operations and component timing. A change
   to a small fraction of total work cannot explain an arbitrarily large overall
   gain. Check for a cache hit, missing work or changed workload.
4. **Correctness:** count errors, timeouts, retries and output quality. Fast
   rejection or worse answers are not an equivalent speed or token improvement.
5. **Repeatability:** for cheap local runs, use at least five per side and
   alternate order. Report median and range. Respect approved budgets for costly
   work; state insufficient replication rather than silently buying more calls.
6. **User relevance:** measure the full path, including cold start, indexing,
   orchestration, tool calls and retries where relevant. Put a microbenchmark in
   context. Distinguish pre-existing setup from recurring user cost.
7. **Actual execution:** verify requests reached the intended implementation,
   results were consumed, and side effects or rows exist where expected. Exclude
   no-ops, unawaited promises and lazy work outside the timed region.

For token claims, reconcile the accounted calls and cached/uncached input,
output and reasoning where available. Include helper/reviewer/orchestrator work;
keep reported token counts distinct from actual billing. Label unavailable
accounting rather than treating it as zero. Compare quality before savings.

Lead with faster, slower, no measurable difference, or inconclusive. Give units,
run count, median/range, source/data configuration, quality/error results and
remaining uncertainty. Do not pick a winner from an unfair comparison or a
difference indistinguishable from measurement noise. Use justified statistics
when needed. Do not promote contaminated data or turn a narrow result into a
general accuracy claim.

Adapted from Lauren Tan's pstack `benchmark-checklist` under MIT; see `LICENSE`
and `upstream.json` for the pinned source.
