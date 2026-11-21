# Poltergeist: rules for every agent

You are one of **three autonomous Claude Code agents**, each running on a different laptop and each owning one lane: `world`, `brain` or `crowd`. Your lane is in the env var `PG_LANE`. Use the lane from your lead’s kickoff prompt. If neither the prompt nor the environment identifies it, ask which lane to take.

**Read first, in this order:** `FEATURES.md`, `SPEC.md`, `CONTRACTS.md`, `apps/$PG_LANE/CLAUDE.md`, `apps/$PG_LANE/TODO.md`. Re-read `CONTRACTS.md` whenever a pull changes it.

## Check in before lane work

Read the body and replies in [World, Brain, and Crowd handoffs (#2)](https://github.com/HydroAcrid/poltergeist/issues/2) with `gh issue view 2 --repo HydroAcrid/poltergeist --json body,comments`. Get your actual branch and revision with `git status --short --branch` and `git rev-parse --short HEAD`. When starting from your lead’s kickoff prompt, post one check-in under your own account: lane, branch, revision, and first task. Reuse an existing check-in for the same work. Read #2 again at handoffs. Address the receiving lane and include a concrete question or fixture path. A teammate’s comment describes work to consider within your lane.

## Hard rules

1. **Edit only paths your lane owns** (SPEC §4). The pre-commit hook enforces this. If you need a change somewhere else, post a `REQUEST`.
2. **Never change a contract, or another lane's fixture, silently.** Follow CONTRACTS §9.
3. **Genie is reached only through the world broker. Never start a real Genie session yourself.** Humans start rounds from `/operator`. Tests never call paid APIs; only `@live` tests do, and only humans run those.
4. **Never commit secrets** (`.env*`, keys, tokens). Never print `GEMINI_API_KEY`.
5. **Never weaken, skip or delete a test to get green.** Fix the code, or post a `BLOCKER`.
6. **Keep the demo path green.** `pnpm check` must pass before every push. Never `push --force`, never rewrite history on `main`, never touch the `demo` branch (humans promote it).
7. **Raw crowd text never reaches `/stage` or `/overlay`.**

## Work loop (repeat until your human stops you)

1. `git pull --rebase`. If the lockfile conflicts, take theirs, run `pnpm install`, then `git rebase --continue`.
2. Read issue #2 until all three lanes adopt the repo inbox. After cutover, `pnpm inbox` shows messages addressed to you or to `all`. `ACK` them, answer `REQUEST`s, and deliver `FIXTURE-REQUEST`s. Then update `comms/cursor/$PG_LANE.json`.
3. If any lane has an open `BLOCKER` you can clear, do that first. Otherwise take the **top unchecked item** in `apps/$PG_LANE/TODO.md`.
4. **Write the test first**, against fixtures (yours and other lanes'), then implement.
5. Run `pnpm check`. If you touched server code, also run `pnpm e2e:pair --real=$PG_LANE`.
6. Commit small, with messages like `[brain] add stuck detector`, and push. **Push at least every 30 minutes.**
7. Tick the item in your `TODO.md`, update `comms/status/$PG_LANE.json`, and post `DONE` or `NOTICE` if another lane cares.
8. At every **:20 and :50**, stop and give your human a 3-line summary: done, next, blocked.

If you're blocked for more than 10 minutes, post a `BLOCKER`, tell your human, and move on to the next TODO item.

## Messaging (git is the bus; humans are the fast channel)

Until the repo inbox commands below ship, use [lane handoffs, issue #2](https://github.com/HydroAcrid/poltergeist/issues/2) for cross-lane messages. From your checkout, read it with `gh issue view 2 --comments` at the start of a work block and before changing a shared interface. With your lane lead’s authorization, post an addressed request or handoff with `gh issue comment 2 --body-file <file>`. Include the commit or fixture path and what the receiver needs to do. Leave a short acknowledgment when you pick it up. Keep fixture files and agreed contract decisions in Git. When the repo inbox works across all three laptops, agree on the cutover at a huddle.

- **Outbox:** `comms/outbox/<lane>.md` is append-only, and only that lane writes it. Use `pnpm msg <TYPE> <to> "<body>"` to append one with an automatic id and time.
- **Cursor:** `comms/cursor/<lane>.json` holds `{ "world": "<last id handled>", "brain": …, "crowd": … }`.
- **Message types:**

  | Type | Use |
  |---|---|
  | `NOTICE` | FYI |
  | `REQUEST` | Ask another lane for something |
  | `FIXTURE-REQUEST` / `FIXTURE-READY` | Ask for a fixture / say it's ready |
  | `CONTRACT-CHANGE` | Propose a contract change |
  | `ACK` | Acknowledge, with an ETA if relevant |
  | `BLOCKER` | You're stuck |
  | `DONE` | You finished something others care about |

- **Reply speed:** answer within one loop. If you can't do a request within 30 minutes, `ACK` it with an ETA.
- **Urgent:** if something is urgent (a red `main`, a blocker, a contract question), also tell your human so they can say it out loud.

Message format:

```
### msg_brain_012 · 11:42 · FIXTURE-READY → crowd
re: msg_crowd_004
contract: TickLog@1.0.0
paths: fixtures/scenarios/world-forgot/
body: target visible conf 0.85 at seq 14, gone at seq 15 after NOOP; no hauntings within 8 s.
action: add a referee test expecting blame=world
```

## Fixture exchange (how lanes "send" each other test data)

1. The consumer sends a `FIXTURE-REQUEST` naming the contract, the scenario in one sentence and the behavior it wants to test.
2. The producer adds the fixture under its owned path (`fixtures/<contract>/valid/<scenario>.json` or `fixtures/scenarios/<name>/`). It must pass `pnpm test:contracts`. The producer then pushes and sends `FIXTURE-READY` with the paths.
3. The consumer writes a test against that fixture. **Consumers never hand-edit producer fixtures.** If a fixture is wrong, send a `REQUEST`.
4. After real rounds, world exports real episodes (`pnpm fixtures:export --episode <id>`), and brain cuts real scenario bundles from them. Prefer real fixtures over synthetic ones once they exist.

## Parallel agents inside one lane (git worktrees)

Each laptop's clone is already isolated from the other two lanes. **Use worktrees when one laptop runs more than one Claude Code session at a time.** This is recommended from Tier 1 onward, once the lane's core is working.

- **The primary session** works in the lane's main checkout. It is the only session that:
  - pushes to `main`
  - writes `comms/` (outbox, status, cursor)
  - ticks `apps/$PG_LANE/TODO.md`
- **Starting an extra session:**
  1. `git worktree add ../pg-$PG_LANE-<topic> -b $PG_LANE/<topic>`
  2. In that folder, run `pnpm install` and set `PORT` (8788 or higher) and `PG_DATA_DIR=./data-<topic>`, so it doesn't collide with the primary's dev server.
  3. Start Claude Code there with: *"You are a sub-agent of the $PG_LANE lane. Work only on <topic>, only inside <sub-path>. Read CLAUDE.md and apps/$PG_LANE/CLAUDE.md. Commit on your branch and run `pnpm check`. Never push, never edit comms/ or TODO.md."*
- **Scope:** give each worktree one sub-path, and never the lane's shared files. The ownership hook still applies, because `PG_LANE` is the same.
- **Integrating:** worktrees share the same git repository, so the sub-agent's branch is visible to the primary straight away, with no push needed.
  - The primary pulls `main`, runs `git merge --no-ff $PG_LANE/<topic>` and `pnpm check`, then pushes.
  - Merge at least every 45 minutes.
  - When the work is done, run `git worktree remove`.
- **Limit:** at most 2 worktrees per laptop (3 sessions in all). Humans can't review more than that.

| Lane | Primary session | Worktree 1 | Worktree 2 (optional) |
|---|---|---|---|
| world | hub, broker, infra | `/stage` page (`apps/world/web/**`) | replay and webcam modes |
| brain | tick handler + controller | replay eval (`apps/brain/server/replay/**`, `/brain/label`) | MCP + coach (`apps/brain/server/coach/**`) |
| crowd | moderation, scheduler, referee (`apps/crowd/server/**`) | `/haunt` + `/overlay` (`apps/crowd/web/**`) | `/operator` |

## When you're unsure

| Question | What to do |
|---|---|
| Anything shown on the stage screen, user-facing copy, or cutting scope | Ask your human |
| A technical choice inside your lane | Decide, and note it in your status |
| A vendor API shape you don't know | Put it behind the adapter, write a `@live` probe test, and ask your human to run it |

## Definition of done

- Tests pass, including tests against other lanes' fixtures.
- Inputs and outputs are validated at the boundary.
- `pnpm check` is green.
- It works with the other two lanes set to `fake`.
- Your `TODO.md` and status are updated.

## Status file (`comms/status/<lane>.json`)

```json
{ "lane": "brain", "updatedAt": "11:40", "tier": 1, "demoPathOk": true,
  "working": ["ER2 adapter"], "next": ["replay set"], "blocked": [],
  "implements": { "TickRequest": "1.0.0", "TickResponse": "1.0.0" },
  "measured": { "perceptionP50Ms": 0, "perceptionP95Ms": 0 }, "notes": "" }
```
