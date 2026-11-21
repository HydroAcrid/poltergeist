# Kevin’s review workflows

Start with **pre-flight** if you want to understand how Kevin decides a change is ready to ship. This kit is for inspection. Each folder can be read directly in Claude Code without installing anything. The four pstack adaptations include their MIT licenses and pinned upstream references.

| Workflow | When it earns its time |
|---|---|
| [Pre-flight](pre-flight/SKILL.md) | A candidate is ready for review. A fresh reviewer examines the base-to-head change, drives the affected product path and records a verdict tied to the commit. |
| [Verify](pstack-verify/SKILL.md) | Someone else needs to reproduce a real journey, from a clean start through the visible result and cleanup. |
| [Blast radius](pstack-blast-radius/SKILL.md) | A change crosses lanes. Trace the producer, consumer and the most consequential assumption, then exercise it. |
| [Benchmark checklist](pstack-benchmark-checklist/SKILL.md) | Someone claims a player is faster, cheaper or more accurate. Check equivalent work, quality, errors and run-to-run variation. |
| [Correct](pstack-correct/SKILL.md) | The same failure keeps recurring. Reproduce it and choose the smallest structural change or test that catches it. |

## Try this in Claude Code

> Read docs/workflows/README.md and the pre-flight workflow, then inspect the Poltergeist feature map and my lane. Which one check would catch a real failure before our first round? Name the action, the result I should see, and what would still be unverified. Give me your assessment before editing files or running a paid session.

For a concrete example, Courtney can test an approved idea and a rejected idea from two phones. The author should see a receipt for both. Only the approved idea should appear on the second phone. A reviewer can then check whether the test would catch accidental publication of the rejected idea.

## Inspect the pre-flight implementation

The [review protocol](pre-flight/references/review.md) explains what the reviewer records. The [verifier](pre-flight/scripts/preflight.py) checks commit, base, evidence and unresolved findings. The [hook and merge notes](pre-flight/references/enforcement.md) explain which checks are local and what requires a separately controlled GitHub App. The review instructions here are adapted for Claude. The Python tools are Kevin’s Codex reference implementation with an empty project registry.

From this directory, with Python 3.10+ and Git installed, run the offline tests against disposable checkouts:

```sh
python3 -B -m unittest discover -s pre-flight/scripts -p 'test_*.py'
```

This package lives outside the active Claude skills directory. Reading it or running the tests grants no release approval and enables no hooks.
