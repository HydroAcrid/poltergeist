# Poltergeist: kickoff kit (read this first, humans)

The [robot reference and haunted hallway](apps/world/robot-v1/README.md) define the character, right-shoulder camera, audience cues and round finish for all three lanes.

Gemini has to reach an exit in a hallway photographed at the venue. Genie 4 turns that photo into the world. The audience is the poltergeist. Someone might drop a banana peel in Gemini’s path or send a gust through the hall. When the change happens, a stylized ghost briefly appears at that spot and fades. The projector shows how Gemini responds and whether it gets out.

## Try the prototype on your laptop

From your existing Poltergeist checkout, run `git pull --ff-only origin main`. Open `apps/world/painted-door/haunting/index.html` from the checkout in your browser. All assets are bundled and the test runs offline without a Gemini key.

Choose **Drop banana peel**, then **Walk ahead** to see the stumble. Once the robot recovers, choose **Walk ahead** again. Reset, drop another peel, choose **Step left**, then **Walk ahead** to reach the far end. Sri can compare the two routes in **Player view**. Courtney can check the brief ghost cue in **Audience view**.

## Joining a round

Kevin’s World host takes the photo and prepares the hallway. Courtney owns the waiting room on phones and the projector, including the join code, assigned names, guest count and first submissions. The host presses Start when the room and audience are ready. Sri’s Brain begins choosing moves from the live frames after play starts.

## During a longer game

Guests join once and keep their ghost names. The host can start a short live round or a game with up to ten minutes of active play. In the longer game, the hallway lights falter and go dark between Genie interactions. The clock holds during the reconnect. Guests can keep submitting hauntings, and the score carries over. The lights return when the projector sees movement in the next stream. The match ends when the robot reaches the exit, the ghosts earn enough scares, or playing time expires.

World prepares the next opening from the current hallway while play is running. It uses a recent settled frame of the same explorer with a clear path ahead, then closes the current interaction before opening the next. If the frame or connection cannot be confirmed, the host reports an interruption. A new interaction can redraw objects, so check placement and the robot's response from fresh video. [Genie 4 session limits](https://aistudio.google.com/docs/genie#limitations)

## The demo in three steps

1. **Make the hallway walkable.** In the first local test, scripted camera controls carried us through the wood arch in Photo 1 and up to the table beneath the skyline picture. That arch gave us a visible finish line for a short test route.
2. **Trigger one activity and reveal the ghost.** In the [local audience prototype](apps/world/painted-door/haunting/index.html), tap a spot in the aisle. The page renders a banana peel there and briefly shows a ghost beside it. The ghost fades by 1.7 seconds and the peel stays until reset. Switch to **Player view** to see the peel with the ghost cue hidden. The empty-hallway background and artwork are included. An earlier 12-second walking-ghost clip tested visibility in this same hallway.
3. **Give Sri’s player a turn.** The local peel prototype uses a full-body view so spectators can see the stumble. In the local playtest, walking straight onto the peel triggered a visible stumble. After recovery the robot could continue. Stepping left first let it reach the end of the test aisle without slipping. The live camera should travel behind the robot’s right shoulder while it walks diagonally from lower left toward upper right. Leave most of the frame for the path, the approaching obstacle and the robot’s response. Extend the venue through connected bays with one reachable exit beyond them. At an encounter the robot can pause to inspect the path, move around a blockage, or recoil from a sudden scare. In the shared round, Sri’s Gemini chooses the moves and the audience supplies one approved activity from a phone. Let Gemini recover and continue. Reaching the designated threshold in time wins the round for Gemini. If time expires, review the replay to see whether the audience’s trick delayed it, Gemini lost its way, or the world changed unexpectedly.

The operator also sent a banana-peel request during a live Genie 4 session. The session completed, but the footage showed no clear peel. A collision in the live Genie world and an autonomous response from Sri’s player still need separate tests.

Clone this repository on your hackathon laptop (or update your existing checkout without overwriting local work). Open Claude Code at the repository root. Paste the prompt for [Sri](#sri--brain) or [Courtney](#courtney--crowd). Use your own GitHub account for lane messages.

| File | What it's for |
|---|---|
| `SPEC.md` | What we're building, the architecture, lanes and ownership, the timeline, cut rules and guardrails |
| `CONTRACTS.md` | Every shape that crosses a lane boundary, the fixtures, fakes, test pyramid and change protocol |
| `CLAUDE.md` | Rules for all three agents: the work loop, messaging and fixture exchange |
| `apps/<lane>/CLAUDE.md` + `TODO.md` | Each lane's mission, owned paths, algorithms and tiered TODO list |
| `comms/` | The git message bus: outboxes, status files and cursors |
| `.env.example` | Every env var. Copy it to `.env` and never commit `.env`. |
| `.claude/settings.json` | Optional permission allowlist, to cut down on prompts. Review it before use. |

## Team assignments

| Lead | Lane | First deliverable |
|---|---|---|
| Kevin | [World](apps/world/TODO.md) | Start from the hallway photo. Frame the avatar’s feet and the hazard together. Apply one approved activity, show the ghost where it happens, and return a fresh frame after each move. Record the finish on replay and close the session. Verify the ledger shows zero active sessions. |
| Sri | [Brain](apps/brain/TODO.md) | Give Gemini a destination and a third-person frame of its avatar. Have it choose a move, observe where its feet land and continue toward the goal. Show its response to a hazard and the evidence it used to claim arrival. |
| Courtney | [Crowd](apps/crowd/TODO.md) | Let someone submit a distraction from a phone. Show private receipts and a shared sidebar of approved ideas. Own the conductor that reserves a feasible, visually readable next effect. Show why it was picked, when World received it, and what appeared. |

Sri and Courtney can swap lanes if they prefer. Confirm your lane in the [laptop check-in](https://github.com/HydroAcrid/poltergeist/issues/1).

The [painted-door replay](apps/world/painted-door/README.md) is an earlier camera test. It shows that a painted object stayed on the wall through a sidestep. A painted exit is one possible audience proposal.

Read the [feature map](FEATURES.md) together before starting lane work. Use the [lane handoffs issue](https://github.com/HydroAcrid/poltergeist/issues/2) until the repo inbox is available.

## Before hacking starts (H−0:15)

- [ ] Confirm you can read the repo and [issue #2](https://github.com/HydroAcrid/poltergeist/issues/2) from your laptop.
- [ ] On every laptop: have Git, GitHub CLI (signed in with your own account), Node 20+, pnpm 9+, ffmpeg, and Claude Code available.
- [ ] If your checkout has no `.env`, copy `.env.example` to `.env`. Set `PG_LANE` to your lane. Kevin's workshop key is already configured locally on the World laptop. Brain and Crowd can start with the default fake adapters. **Only the World laptop** sets `PG_ALLOW_GENIE=1` for a live session.
- [ ] Host account ready, using whichever host you practiced on. It needs WebSockets, a single instance, a persistent disk and auto-deploy from a branch. You'll create two services: **staging** (from `main`) and **prod** (from `demo`).
- [ ] Generate random tokens for `PG_TOKEN_*`, `PG_OPERATOR_TOKEN` and `PG_MCP_TOKEN`, share them through a password manager, and put them in the host secrets too.
- [ ] Agree on roles: the world, brain and crowd lane leads, plus the operator and MC (a 4th person, or the crowd lead).

## H+0:00 – H+1:30 run sheet

| Time | world laptop | brain laptop | crowd laptop | Humans |
|---|---|---|---|---|
| **0:00** | Commit this kit and push | Pull | Pull | **world lead:** check the Genie API event names in the official docs or cookbook. **brain lead:** check ER 2's output format. **crowd lead:** take ~20 hallway photos with an EXIT sign visible and send them to the brain lead. |
| **0:00–0:20** | Agent: root scaffold, hub, `common`/`envelope` (others are waiting) | Agent: brain contracts and fixtures, written locally | Agent: crowd contracts, fixtures, presets and moderation cases, written locally | Paste the prompts below |
| **0:20–0:30** | World contracts and fixtures | Rebase on the scaffold and push | Rebase on the scaffold and push | **5-min contract review**; once `pnpm test:contracts` is green, run `git tag contracts-v1 && git push --tags` |
| **0:30–1:00** | Fake world, e2e harness | Fake brain and scenario bundles, then the controller | Fake crowd, then the haunting API | |
| **1:00** | `pnpm e2e:fake` green on `main`; staging and prod deployed | | | Check that `/stage` and `/haunt` load on prod |
| **1:30** | First real Genie round from `/operator` → `pnpm fixtures:export` | Switch tests to real frames; measure latency | Referee tests on real ticks | **Tier 0 check: apply the cut rules (SPEC §9)** |

## Huddles and haunting rounds

- **Huddles** happen at every **:20 and :50**, standing, for 5 minutes:
  - Each lead reads their agent's 3-line summary.
  - Raise blockers and contract questions.
  - Decide whether to promote to prod: `git checkout demo && git merge --ff-only main && git push`.
- **Haunting rounds** start at H+3:00, at :00, :15, :30 and :45. The operator starts each one from `/operator`.
- **Never promote within 5 minutes of a round.**
- **Watch the inboxes:** keep `pnpm inbox` and `pnpm status` running in a side terminal on each laptop. If a `BLOCKER` or `REQUEST` names your lane, interrupt your agent.

## Paste-in prompts (one per laptop, pasted right after the kit is pulled)

### World laptop
```
You are the WORLD lane agent for our hackathon project, Poltergeist. PG_LANE=world.
Read CLAUDE.md, SPEC.md, CONTRACTS.md, apps/world/CLAUDE.md and apps/world/TODO.md in full before doing anything.
Your first job is the "Setup" section of apps/world/TODO.md. The other two agents are blocked until it lands, so push a minimal working scaffold by H+0:20: a hub that boots with no-op lane modules, a validating bus, the contracts package with common/envelope/registry/hub-types/index and the fixture test, the scripts, git hooks and CI. Then write the world-owned contracts and fixtures, then the fake world and the e2e harness.
After that, follow the work loop in CLAUDE.md continuously, working down apps/world/TODO.md.
Never start a real Genie session yourself: build the broker with FakeGenieAdapter tests and a @live probe, and ask me to run it.
Give me a 3-line summary (done / next / blocked) at every :20 and :50.
```

### Sri · Brain

```text
I'm Sri. Start my Brain lane (PG_LANE=brain). Read FEATURES.md, CLAUDE.md, SPEC.md, CONTRACTS.md, and the Brain lane guide and TODO. Read issue #2 and post my check-in with my lane, branch, short commit, and first task. Use #2 to acknowledge handoffs and share blockers or ready fixtures with World and Crowd.

Start the Brain contracts and fixtures. Use the committed frames in apps/world/painted-door/replay/ for a first movement test with the fixture adapter. Try apps/world/painted-door/haunting/index.html in Player view, then ask World on #2 for labeled camera fixtures. Use those to test avoidance, recovery and arrival. Give Gemini the destination and camera view. Keep the audience's proposal, ghost cue and labeled answer out of its input. Share the fixture path and what you verified on #2. Use local fakes for this first pass.
```

### Courtney · Crowd

```text
I'm Courtney. Start my Crowd lane (PG_LANE=crowd). Read FEATURES.md, CLAUDE.md, SPEC.md, CONTRACTS.md, and the Crowd lane guide and TODO. Read issue #2 and post my check-in with my lane, branch, short commit, and first task. Use #2 to acknowledge handoffs and share blockers or ready fixtures with World and Brain.

Start the Crowd contracts, fixtures, and an activity preset such as “Drop a banana peel in the aisle.” Build toward a two-phone test where the author immediately gets a private receipt, rejected text stays private, and approved ideas appear on both phones. Design the conductor and its sidebar using the feature map. Show the reserved “Up next” idea with a short reason and let each player switch between “All ideas” and “Mine”. Use rules-only moderation and a fake World for this first pass. Share the fixture path and what you verified on #2.
```

## If something goes wrong in the first hour

| Problem | Do this |
|---|---|
| Scaffold not on `main` by H+0:25 | The world lead pushes whatever exists. Brain and crowd keep writing fixtures, which don't need the hub. |
| The Genie API shape differs from the spec | It's internal to world (`GenieAdapter`), so no contract changes. The world lead updates `apps/world/CLAUDE.md`. |
| ER 2 output differs | It's internal to brain (`PerceptionAdapter`), so no contract changes. |
| A real contract gap | Send `CONTRACT-CHANGE` before H+3:00, decide at a huddle, and land one `[contract-migration]` commit (CONTRACTS §9). |
| Two agents keep conflicting | They're editing outside their owned paths, so check the hook is installed (`pnpm install` sets up the hooks). |

## Issue notifications

Opening an issue or posting a comment in [lane handoffs, issue #2](https://github.com/HydroAcrid/poltergeist/issues/2) triggers [Issue intake](https://github.com/HydroAcrid/poltergeist/actions/workflows/issue-intake.yml). Its run summary links to the item and lists lane names and blocker language. Each Claude session reads #2 when starting or handing off work. The GitHub check runs independently of the laptops.
