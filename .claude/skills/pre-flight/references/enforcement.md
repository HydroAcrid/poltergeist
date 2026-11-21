# Triggering and enforcing pre-flight

The skill can be invoked as `$pre-flight`; its description also matches PR and
merge requests. Skill selection alone is not a hard gate.

## Local Codex hook

The `scripts/hook.py` adapter reads native PreToolUse input and checks scoped
release commands against the local verifier. `projects.json` identifies personal
workspace roots and repository mappings; projects outside those roots are not
silently enrolled. Future repositories within an enrolled root require their own
review configuration and genuine approval. Do not fabricate approval to get past
an inconvenient hook.

In the original Codex setup the definition lives in `~/.codex/hooks.json`. Codex requires review/trust
of its exact definition; inspect `/hooks` in a supported Codex CLI and trust that
definition after reviewing the files. Restart/reload when needed. Writing the
file does not establish that a running chat loaded or trusted it. Preserve other
hook sources/handlers. See the [official hook documentation](https://learn.chatgpt.com/docs/hooks).

The adapter emits the supported explicit deny JSON, catches verifier errors,
and never starts a nested agent or evaluates shell input. Supported local flows
include reviewed current-HEAD pushes, explicit-base PR creation with a matching
local origin tracking ref, and reviewed ancestor-only `git merge --ff-only`.
Ambiguous scoped targets fail closed. A tracking ref is a convenience snapshot,
not live server attestation; confirm the remote PR head in the actual workflow.
Remote PR merge requires the trusted GitHub check rather than local authority.

Hooks have real limits: shell parsing is bounded, tool paths may bypass hooks,
interactive `write_stdin` does not re-run PreToolUse, and native errors/timeouts or
untrusted hooks may fail open. A human or another client can bypass local hooks.
Do not claim this prevents every merge, or disable the hook to make a release pass.

## GitHub merge boundary

The enforceable setup is a separately controlled Flight Bot GitHub App that
reviews the exact server PR head and current base, then emits `pre-flight/flight-bot`
success only after genuine independent approval and checks. Keep its signing/API
credentials in a trusted controller outside candidate-controlled code. Never run
candidate scripts with the bot's credentials. An editable PR workflow that reads
a writer-authored JSON receipt does not authenticate independent review.

Require PRs and the bot check on main, bind the check to the App's actual numeric
integration ID, require an up-to-date base or correctly reviewed merge-queue
candidate, block force pushes/deletion, and avoid ordinary bypass actors. Dismiss
stale human reviews if those are also required. A changed head/base must invalidate
prior bot approval. Treat skipped/neutral checks as unapproved in the trusted
controller: GitHub can otherwise consider those required-check outcomes acceptable.

`scripts/ruleset.py --app-id <actual-installed-app-id>` emits a reviewable ruleset
request with these requirements. It does not install an App, create a token,
publish a check, change GitHub settings, or assert that protection is active.
Activate only with authorized repository administration, then read back live
rules and test that an unapproved disposable PR cannot merge. Administrators can
still change protection. Never describe a prepared payload as an active gate.

GitHub currently permits rulesets on public Free repositories and eligible paid
private repositories. Preserve private source when account eligibility blocks
rules; do not make a repository public as a workaround. See
[GitHub ruleset requirements](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).
