# Review and receipt protocol

Start from the user's intended behavior and the full base-to-head diff. Inspect
actual source and independently exercise risky paths. Include deleted files,
configuration, workflows, dependencies and data boundaries. Keep established
project rules when stronger than this shared minimum.

For UI, inspect fresh rendered desktop/mobile captures and the live journey.
Check text, focus, pointer/touch targets, keyboard flow, overflow, long content,
loading/empty/error states and native behavior where relevant. Inspect motion in
time: opening, closing, rapid repeat input, interruptions, viewport changes,
scroll position and reduced motion. Distinguish actual physical-device/platform
checks from Chromium emulation. Do not approve an entire app from one hero image.

Useful sensitivity probes are a wrong route, lost form state, clipped commands,
missing validation, an accessibility interaction failure, displaced critical UI,
or an interrupted disclosure/incorrect indicator. Select risks from this change;
do not inject an arbitrary failure merely to fulfill a count. Compare screenshots
with reviewed baselines and behavior with outcomes. Keep a clean control and a
restored pass around the intended mutant failure. Exact selector/failed assertion
and zero infrastructure errors matter more than screenshot volume.

## Private state and execution

Find the Git-private directory with `git rev-parse --git-path pre-flight`.
Configuration is `config.json`, command records/logs are under `checks/`, and
the final receipt is `approvals/<head_sha>.json`. In linked worktrees, use that
worktree's path. Avoid checking evidence/receipts into the reviewed tree: it
would create a self-referential approval. Keep filenames unique across reruns.

The runner uses argument arrays, not a shell. For shell-specific commands, pass
the explicit shell and script as arguments. Tests must not leave tracked or
untracked candidate changes. Generated ignored artifacts and private state are
allowed. Logs must be sanitized and use fictional data. Never print credentials.

## Final receipt shape

Flight Bot writes this JSON only after its actual independent review. `candidate`
is copied exactly from `snapshot`, including its config and policy digest.
`reviewer.id` is the real fresh agent/task identity and `implementer_id` identifies
the implementing agent. No helper command grants approval on behalf of a bot.

```json
{
  "schema_version": 1,
  "candidate": {},
  "reviewer": {"id": "fresh-agent-identity", "implementer_id": "author-identity", "fresh_context": true},
  "verdict": "approve",
  "review_notes": {"path": "review/final.md", "sha256": "file-sha256"},
  "areas": {
    "correctness": {"status": "reviewed", "reason": "Observed paths and edge cases."},
    "security": {"status": "reviewed", "reason": "Assessed relevant inputs and data boundaries."},
    "maintainability": {"status": "reviewed", "reason": "Inspected the full diff and existing conventions."},
    "performance": {"status": "reviewed", "reason": "Assessed the changed path."},
    "product": {"status": "reviewed", "reason": "Compared against acceptance criteria."},
    "tests": {"status": "reviewed", "reason": "Examined assertions, selection and sensitivity evidence."},
    "accessibility": {"status": "reviewed", "reason": "Exercised relevant inputs and focus."}
  },
  "findings": [],
  "checks": [],
  "sensitivity": [],
  "ui": {"applicable": false, "reason": "A specific non-UI scope reason."},
  "limitations": ["The actual remaining verification boundary."]
}
```

The empty objects/lists above describe the format, not an approvable software
receipt. For software, `checks` contains file/hash references returned by
`run-check --kind test`. Each `sensitivity` item contains `risk`, `control`,
`mutant`, and `restored` references to those corresponding runner records. All
three runs must identify the same test and occur in order. `mutant` needs the
exact expected assertion text and exit code 1; other runs need exit code 0.
Supported summaries are verbose unittest, Playwright line output and pytest.
Controls/restored runs must select one executed passing test with no skips;
mutants must select one assertion failure with no runtime errors. Unknown runner
output fails closed. Interface profiles require rendered review even for
content-only Markdown changes.

For UI, use `ui.applicable: true`, `inputs: ["pointer", "keyboard", "touch"]`,
`motion_reviewed: true`, and `desktop`/`mobile` objects. Each has its viewport
`width`, `capture` file/hash reference, and a concrete `journey` description.
Copy genuine reviewer captures into private evidence storage. Use complete PNGs
matching the recorded viewport width; corrupt or differently sized files do not
satisfy the check. Explain motion/reduced-motion observations in review notes.

For a native desktop product, configure `--native-ui --reason <scope>` instead
of the responsive-web `--ui` profile. Review a real desktop/native capture and
pointer/keyboard behavior; specify `mobile: {"not_applicable": true, "reason":
"specific native-only rationale"}` in the UI report. Existing platform validation
requirements still apply. Do not use this profile to avoid mobile review for a
responsive website. Config changes invalidate prior receipts and check records.

A finding contains stable `id`, `severity` (`need_to_fix`, `should_fix`, `nit`),
`status`, and `reason`. Blocking findings require `status: fixed` or
`technically_disproven`, `reviewer_confirmed: true`, and an `evidence` file/hash
reference. For a nit, use `fixed` or `skipped` with the main agent's reason.
Include the reproduction, consequence and changed lines in the human report.
Preserve the prior finding IDs when repair changes the candidate.

## Scope and trust

The validator detects missing/stale evidence and unresolved findings. It does
not prove the identity or honesty of a person/process that can rewrite its
inputs. Artifact hashes protect correspondence, not authorship. Independent
agents and genuine reports are a workflow requirement. Remote enforcement must
use an independently controlled bot identity; see enforcement.md.
