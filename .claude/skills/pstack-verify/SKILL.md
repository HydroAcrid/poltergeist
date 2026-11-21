---
name: pstack-verify
description: Create or maintain a project-specific verification skill and feature map that exercises the real app. Use when a repo lacks repeatable end-to-end verification or its verification instructions have drifted; routine checks should use the existing harness.
license: MIT
disable-model-invocation: true
---

# Project verification

Read project/vault instructions and inspect the existing launch commands, tests,
fixtures and supported control surfaces. Prefer the established harness. Keep
work within the user's task; skill installation alone does not authorize changing
an app, accessing private accounts, publishing, or taking external actions.

## Discover the real path

Identify the surfaces users touch, setup/authentication prerequisites, launch and
readiness checks, stable commands/selectors, observable outputs, and teardown.
Check whether concurrent instances can have separate ports, profiles and data.
Use disposable fictional data. Isolate from the user's session; explain a missing
precondition precisely instead of silently substituting a mock or weaker journey.

## Write or repair the project skill

Use the project's established skill directory, normally
`.agents/skills/verify-<app>/`. Create a concise `SKILL.md` with valid frontmatter
and these sections:

- **Launch:** exact commands from an empty disposable state, setup and readiness.
- **Doctor:** read-only process/build/auth/data checks before driving the instance.
- **Drive:** real user paths using stable semantic selectors or actual CLI/API
  commands. For UI, include applicable desktop/mobile, keyboard, touch, focus,
  reduced motion, interruptions and failure/recovery states.
- **Evidence:** action plus observable result, relevant persistence or side
  effects, and named artifact locations. Screenshots alone do not prove behavior.
- **Cleanup:** stop only owned processes and remove only owned disposable state.
  Preserve evidence. Never kill every process with the same name.

Add a small `features/README.md` index and feature files for the important
journeys. Each names its entry points, preconditions, actions, expected visible
and persisted outcomes, and known limitations. Start with the highest-risk 3-5
features; mark uncovered paths explicitly. Never invent commands or selectors.

For maintenance, compare the map with current source and actual behavior. Repair
proven drift and add missing meaningful journeys without redesigning the app.

## Prove the instructions

Execute the written launch, doctor, drive, evidence and cleanup sequence for at
least one mapped feature. Retain its artifacts after cleanup. Where a regression
check is added, demonstrate a pristine pass, a representative isolated mutation
failing the intended assertion, and a restored pass. A crash, empty selection or
missing baseline is inconclusive. Review baselines before accepting them.

Report the exercised feature, actual commands/results, retained evidence,
uncovered paths, and browser/platform/emulation limits. A generated skill that
has not run remains a draft. It does not grant release approval; preserve the
project's independent review gate.

Adapted from Lauren Tan's pstack `create-verification-skill` under MIT; see
`LICENSE` and `upstream.json` for the pinned source.
