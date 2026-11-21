---
name: pre-flight
description: Independent code and product review before creating a PR, pushing a release candidate, or merging into main. Requires fresh Flight Bot approval, applicable desktop/mobile review, and demonstrated regression detection. Also use for an explicit pre-flight or full quality review.
---

# Pre-flight

Review the actual candidate, fix real defects, and obtain independent Flight Bot
approval before the requested PR or merge. Tests and screenshots alone are not
approval. Preserve product intent and unrelated working changes. When the team elects to use pre-flight, agree on the candidate and arrange a fresh reviewer.

## Candidate and evidence

Read applicable project instructions. Inspect Git state, target base,
acceptance criteria and changed journeys. Use established checks; add focused
tests for meaningful uncovered risks, not assertions that repeat implementation.
Do not weaken checks, hide UI, omit failures or update baselines to create a pass.
Preserve unrelated edits and use isolation when needed.

Commit the intended candidate before final review. Approval binds the complete
Git commit/tree, base commit, policy and evidence. Relevant changes invalidate
approval. Keep receipts and sanitized evidence in Git-private storage, outside
the candidate tree. Never use credentials or private task records as test data.

Configure with `scripts/preflight.py init --repo <root> --base-ref <ref> --ui`.
Use `--native-ui --reason <scope>` for a desktop-only app, or
`--no-ui --reason <scope>` for a project without a rendered interface. Then
run `snapshot --repo <root>`. Retain any stronger review requirements in the project.

## Prove that tests detect regressions

For changed software, demonstrate the most important changed risks through a
pristine pass, a deliberate regression, the intended assertion failure, and a
restored pristine pass. Use isolated fixtures, test-only injection or an isolated
checkout. Never leave a mutant in production or the candidate.

`run-check --repo <root> --kind test|control|mutant|restored --name <unique-id>
--test-id <visible-test-name> [--expected-assertion <text>] -- <argv>` records
actual commands/results and private logs. Select commands that print the test
identifier. Crashes, timeouts, empty selections and missing baselines do not prove
sensitivity. Read [review protocol](references/review.md) for examples and receipt
format. Documentation-only changes may explain non-applicability; software
changes require meaningful tests and representative sensitivity evidence.

## Fresh full review

For a Claude Code trial, open a fresh reviewer session with read-only access to
the candidate and a way to exercise the changed behavior. A teammate can run
this from their checkout. Kevin calls this reviewer Flight Bot. The original
Codex setup uses a fresh Flight Bot agent without inherited conversation history.
Record which reviewer and runtime actually performed the review.

Give the reviewer the candidate/base IDs, acceptance criteria, relevant project instructions,
preview/test instructions and raw evidence. Do not give the author's conclusions
or an expected verdict. It must inspect source/diff and behavior independently.
No recursive delegation unless authorized. If independent review is unavailable,
leave approval absent and report the limitation; do not substitute self-review.

Review correctness, security/privacy, maintainability, performance, product
behavior, accessibility and test effectiveness. Mark irrelevant areas with a
specific reason. For interface changes, inspect the actual current candidate on
desktop (normally 1440px) and mobile (normally 390px, plus risky breakpoints such
as 360px). A desktop-only native app requires desktop review and an explicit
reason mobile is inapplicable. Walk changed journeys with pointer, keyboard and
touch emulation where applicable.
Check readable content, focus, overflow, relevant loading/empty/error states,
reduced motion and real opening/closing/reversal/scrolling behavior. Still images
cannot establish smooth motion. State browser, platform and emulation limits.

## Findings and repair

| Severity | Disposition |
| --- | --- |
| Need to fix | Blocks approval until fixed or technically disproven. |
| Should fix | Also blocks approval until fixed or technically disproven. |
| Nit | The implementing agent may fix or skip it, recording a concise reason. |

Keep finding IDs across rounds. The author may challenge a finding with source,
reproduction or test evidence. Flight Bot must evaluate the challenge and confirm
a technical disproof; the author cannot clear blockers by assertion. Fixed
findings require rechecking the changed candidate and relevant tests. Pure style
preferences without engineering/product impact belong in Nits. Stop for concrete
unresolved product decisions or unavailable dependencies instead of granting a
false approval or expanding into an open-ended redesign.

## Approval and release

Flight Bot writes its genuine report and final receipt using the
[protocol](references/review.md). The main agent must not fabricate its identity,
findings or verdict. Run `verify --repo <root>` immediately before a PR or push.
Nits may remain. Report exact candidate, fixes, verification, verdict and limits.

Read [enforcement](references/enforcement.md) for hooks and merge controls.
Local receipts/hooks guard against mistakes; they do not authenticate an agent.
GitHub merge enforcement requires a successful check from a trusted, separately
credentialed Flight Bot App and active branch rules. Installing a skill, writing
a receipt, or configuring an untrusted hook does not activate that protection.
Respect native hook trust/reload requirements and verify live rules separately.
