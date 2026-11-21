# Team review skills

Pull the repo and open Claude Code in the checkout. Type a command on its own or follow it with the change you want to review. If the commands are missing in an open session after pulling, restart Claude Code from this checkout.

| Command | Use it when |
|---|---|
| [`/pre-flight`](../../.claude/skills/pre-flight/SKILL.md) | A candidate is ready for independent code and product review. |
| [`/pstack-verify`](../../.claude/skills/pstack-verify/SKILL.md) | A teammate needs a repeatable way to exercise a real user journey. |
| [`/pstack-blast-radius`](../../.claude/skills/pstack-blast-radius/SKILL.md) | A change could affect another lane or consumer. |
| [`/pstack-benchmark-checklist`](../../.claude/skills/pstack-benchmark-checklist/SKILL.md) | A claim about speed, cost, or accuracy needs evidence. |
| [`/pstack-correct`](../../.claude/skills/pstack-correct/SKILL.md) | A recurring mistake calls for a guard or regression test. |

These commands run on request. For example, try `/pstack-blast-radius What happens to the phone queue if World acknowledges a proposal twice?`

Pre-flight includes the [review protocol](../../.claude/skills/pre-flight/references/review.md), [verifier](../../.claude/skills/pre-flight/scripts/preflight.py), and [enforcement notes](../../.claude/skills/pre-flight/references/enforcement.md). To run its offline reference tests from the repository root with Python 3.10+ and Git:

```sh
python3 -B -m unittest discover -s .claude/skills/pre-flight/scripts -p 'test_*.py'
```

Each pstack skill includes its MIT license and pinned upstream reference.
