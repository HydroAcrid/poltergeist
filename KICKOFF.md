# Poltergeist: kickoff kit (read this first, humans)

Drop the **contents** of this folder into the root of an empty repo at H+0:00. It contains **no project code**, only specs, agent instructions, an env template and empty comms files. Before relying on it, confirm with the organizers that bringing design docs is allowed.

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
| Kevin | [World](apps/world/TODO.md) | Start a hallway session, add a painted exit, and move sideways. Record the door head-on and from the side so the team can see whether the illusion holds. Close the session and verify the ledger shows zero active sessions. |
| Sri | [Brain](apps/brain/TODO.md) | Give the player a hallway frame and show its chosen move. Try the decoy and record whether the player changes its viewing angle or walks up to the painting. |
| Courtney | [Crowd](apps/crowd/TODO.md) | Put a “Paint a fake door” preset on the phone page. Show when the request is queued and when World sends it to the scene. Check the stage view to see when the door actually appears. |

Sri and Courtney can swap lanes if they prefer. Confirm your lane in the [laptop check-in](https://github.com/HydroAcrid/poltergeist/issues/1).

Kevin’s [painted-door replay](apps/world/painted-door/README.md) shows the first sideways test. Courtney’s first phone flow shows a private submission receipt, filters the idea, and puts approved proposals in a shared first-in, first-out queue. Players can filter the list to their own ideas.

For the first shared round, Courtney triggers the trick from a phone, Sri shows the player's move, and Kevin replays the choice. Score the round by which exit the player chose. Reaching the painting counts as a win for the ghost.

Read the [feature map](FEATURES.md) together before starting lane work. Use the [lane handoffs issue](https://github.com/HydroAcrid/poltergeist/issues/2) until the repo inbox is available.

## Before hacking starts (H−0:15)

- [ ] One person creates an empty private GitHub repo and adds everyone.
- [ ] On every laptop: install Node 20+, pnpm 9+, ffmpeg, and Claude Code (signed in), then clone the repo.
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

### Brain laptop
```
You are the BRAIN lane agent for our hackathon project, Poltergeist. PG_LANE=brain.
Read CLAUDE.md, SPEC.md, CONTRACTS.md, apps/brain/CLAUDE.md and apps/brain/TODO.md in full before doing anything.
Start with "Setup" in apps/brain/TODO.md: write the brain-owned contract schemas and fixtures exactly per CONTRACTS.md, and commit locally. Keep running `git pull --rebase` until the world lane's scaffold lands (server/hub exists), then rebase, get `pnpm test:contracts` green, and push.
Next: the fake brain, then the six scenario bundles (the crowd referee depends on them; send FIXTURE-READY), then the controller as a pure, heavily unit-tested function, then the real /api/brain/tick.
After that, follow the work loop in CLAUDE.md continuously, working down apps/brain/TODO.md.
Paid model calls only happen in @live tests, and I run those. Never start Genie sessions.
Give me a 3-line summary (done / next / blocked) at every :20 and :50.
```

### Crowd laptop
```
You are the CROWD lane agent for our hackathon project, Poltergeist. PG_LANE=crowd.
Read CLAUDE.md, SPEC.md, CONTRACTS.md, apps/crowd/CLAUDE.md and apps/crowd/TODO.md in full before doing anything.
Start with "Setup" in apps/crowd/TODO.md: the crowd-owned contract schemas and fixtures, presets.json, seeded-pool.json and moderation-cases.json (placeholder tokens only, never real slurs or names). Commit locally, keep running `git pull --rebase` until the world lane's scaffold lands, then rebase, get `pnpm test:contracts` green, and push.
Next: the fake crowd, then POST /api/crowd/haunt with rules-only moderation, the queue and scheduler, and the /haunt phone page. Write the referee rule test-first against brain's scenario bundles; if one is missing, send a FIXTURE-REQUEST and work on something else meanwhile.
After that, follow the work loop in CLAUDE.md continuously, working down apps/crowd/TODO.md.
Raw crowd text must never reach /stage or /overlay. Paid model calls only happen in @live tests, and I run those.
Give me a 3-line summary (done / next / blocked) at every :20 and :50.
```

## If something goes wrong in the first hour

| Problem | Do this |
|---|---|
| Scaffold not on `main` by H+0:25 | The world lead pushes whatever exists. Brain and crowd keep writing fixtures, which don't need the hub. |
| The Genie API shape differs from the spec | It's internal to world (`GenieAdapter`), so no contract changes. The world lead updates `apps/world/CLAUDE.md`. |
| ER 2 output differs | It's internal to brain (`PerceptionAdapter`), so no contract changes. |
| A real contract gap | Send `CONTRACT-CHANGE` before H+3:00, decide at a huddle, and land one `[contract-migration]` commit (CONTRACTS §9). |
| Two agents keep conflicting | They're editing outside their owned paths, so check the hook is installed (`pnpm install` sets up the hooks). |
