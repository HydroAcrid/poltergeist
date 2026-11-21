# Crowd lane handoff (for Google Antigravity)

You're picking up the **Crowd lane** of **Poltergeist** (`github.com/HydroAcrid/poltergeist`) from a Claude Code session. Courtney leads Crowd. Read this first, then `CLAUDE.md`, `apps/crowd/CLAUDE.md`, `apps/crowd/HANDOFF.md` and `CONTRACTS.md`.

## The project in one paragraph
A room of strangers haunts a robot. Guests open `/haunt` on their phones and send short ideas ("fog rolls in"). Crowd moderates and rewrites them with Gemini, and its **conductor** picks the best one for what's on screen right now. World (Kevin, `@HydroAcrid`) places it in a **Genie 4** hallway. A flashlight robot driven by Brain (Sri, `@srikondapalli1`, Gemini Robotics ER 2) tries to get past it to the exit. Crowd's **referee** decides who's to blame when the robot fails. The **scoreboard and kill feed** show on the projector overlay (`/overlay`).

## Where things are
| What | Path / branch |
|---|---|
| Crowd's working branch (pushed, up to date) | `crowd/haunt-flow`, at `6ebc784` |
| Crowd's worktree | `~/Downloads/hackathon-projects/pg-crowd-haunt` |
| Background agent's worktree (all its work is merged) | `~/Downloads/hackathon-projects/pg-crowd-inbox`, branch `crowd/inbox` |
| Local test checkout of World's host | `~/Downloads/hackathon-projects/pg-rehearsal` (branch `crowd/rehearsal-try`, local only) |
| Primary checkout (`main`) | `~/Downloads/hackathon-projects/poltergeist` |
| Team messages | GitHub issue #2: `gh issue view 2 --repo HydroAcrid/poltergeist --comments` |
| Judging Q&A prep | private page: https://claude.ai/artifact/9P2zgbqq1uKWFJjnxr3iBb |

Crowd owns `apps/crowd/**` and the contract files `packages/contracts/src/{haunt,verdict,scoreboard,operator}.ts`. A pre-commit hook blocks edits to other lanes' paths.

## Run it
```bash
cd ~/Downloads/hackathon-projects/pg-crowd-haunt/apps/crowd
pnpm install --ignore-workspace --allow-build esbuild   # once
./node_modules/.bin/vitest run                          # 239 tests, all passing
./node_modules/.bin/tsc --noEmit -p .                   # typecheck
PORT=8788 ./node_modules/.bin/vite-node -c vitest.config.ts dev/dev-hub.ts   # dev hub
```
- **Dev hub:** phone page `http://localhost:8788/haunt`, round controls `/dev`, overlay `/overlay`. Phones on the same Wi-Fi use the laptop's LAN IP, which the hub prints at startup.
- **World's rehearsal host:** needs Node 22. In `pg-rehearsal`, run `PG_CROWD_SCENE_URL=http://127.0.0.1:8914/rehearsal/state npm run rehearsal` on port 8914. Pages are `/stage`, `/overlay` and `/haunt`.

## Gemini keys (security rules, don't break these)
- Courtney's two keys live in **`~/.config/poltergeist/crowd.env`** (chmod 600, outside the repo) as `PG_CROWD_GEMINI_KEY` and `PG_CROWD_GEMINI_KEY_2`. **Never print, copy, commit or paste them anywhere.**
- The dev hub reads that file by default. World's host needs `PG_CROWD_ENV_FILE=$HOME/.config/poltergeist/crowd.env`. On Vercel, set them as encrypted env vars.
- Code: `server/moderation/keys.ts` (loading, refuses a group/world-readable file, never writes to `process.env`) and `server/moderation/gemini.ts`:
  - key 2 takes over on 401/403/429/5xx, and the failed key rests 60 s
  - a cap of `PG_CROWD_GEMINI_MAX_PER_MIN` calls a minute (default 120)
  - keys go only in the `x-goog-api-key` header and are scrubbed from logs
  - details in `docs/gemini-keys.md`
- **Not verified live yet.** Preset chips skip Gemini; only typed ideas go through it.
  - Key 1 is 53 characters and doesn't start with `AIza`, so it may not be a standard Gemini API key. If logs show `HTTP 4xx on key 1 of 2`, replace it with an AI Studio key.
- Tests never call paid APIs. Only humans run `@live` tests.

## What's done (all on `crowd/haunt-flow`)
**Phone page `/haunt`**
- four screens with a bottom nav: Haunt, Up next, Hallway, Mine
- 3 suggestion chips plus a "+ More ideas" page, in a compact 2×2 grid (`6ebc784`)
- Speak (Web Speech API), a "Sent!" page, and an assigned ghost name
- **one waiting idea each**: a new idea replaces your waiting one
- a waiting-room card that follows World's `/rehearsal/lobby` phase
- Kevin's paged queue (ETag, gzip, about 10 KB)

**Scheduler and conductor** (`server/crowd.ts`, `server/conductor.ts`, `server/scene.ts`)
- picks ideas that fit World's live scene, and falls back to FIFO if the scene is stale (over 3 s)
- **Up next is reserved only once a round is playing**; in the lobby, guests can keep changing their idea
- reasons for holding an idea go in `CrowdState.holds`

**Moderation**
- the rules pre-filter catches invisible characters, leetspeak, spaced letters, look-alike Cyrillic/Greek letters and markup
- Gemini output is cleaned and re-checked
- private revise suggestions

**Referee and scoreboard** (`server/referee.ts`, `server/scoreboard.ts`): rule-first verdicts, scenario fixtures from Brain, the kill feed, and scares.

**Overlay** (`web/overlay.html`): compact side-on layout, ghost veil, waiting-room guest count, and a Start button in the drawer.

**Operator endpoint:** `POST /api/crowd/operator`. It needs header `x-pg-token` (dev token `dev-operator`) and accepts only `haunt.approve`, `haunt.reject`, `haunt.releaseSeeded` and `finals.approvalMode`.

## Open decisions for Courtney (ask her; don't decide alone)
1. **Kevin's edits to Crowd files.** His branch `origin/codex/shoulder-crowd-rehearsal` is the team's shared rehearsal branch, and it changed Crowd files without a CONTRACT-CHANGE post. It adds a "hallway match" mode:
   - `EpisodeEnded.hallway` with end reasons exit/time/fear/interrupted
   - Haunt 1.10.0, Verdict 1.1.0 and Scoreboard 1.1.0 additions
   - in the referee, time → agent blame and fear → adversary
   - scares count as landed
   - new kill-feed lines "X scared the robot · …" and "X made the robot sidestep · …"
   
   He copied Crowd commits rather than merging, so it **conflicts with `crowd/haunt-flow` in about 10 files**: `server/{crowd,index,routes,scene}.ts`, `docs/conductor.md`, tests and the web pages. The recommendation Courtney hasn't answered yet: adopt his changes, merge his branch into `crowd/haunt-flow` resolving conflicts, run every test, push, and ask Kevin on #2 to merge rather than copy.
2. **Referee timeouts where the target stayed visible.** The old rule blames the haunting (failureT falls back to the last tick), which gives fake 💀 wins. Brain's scenarios `hazard-after-haunt` and `no-hazard-after-haunt` show it. Recommendation: if the robot never lost the target, blame `agent` with no culprit. Then add `test/expected/{hazard,no-hazard}-after-haunt.json`, writing the tests first. Kevin's hallway path already does this for hallway rounds.
3. **`/operator` page UI.** The endpoint exists, but the layout and copy need Courtney's OK.

## Next steps, in order
1. Courtney sends a **typed** idea on `/haunt` with the dev hub running. Check its log to confirm Gemini answered (`moderated.model` is `gemini-4-hydrogen`) and which key worked. Use `GET /api/crowd/queue` with `x-pg-token: dev-operator` to see the model.
2. Get her answers on decisions 1 and 2, then do the merge and the referee fix.
3. **Physical-phone test:** QR scan to `/haunt`, Speak, real Gemini moderation.
4. Read #2 at each step, answer anything addressed to Crowd, and post DONE notes with commit SHAs.

## Team rules (from `CLAUDE.md`)
- Edit only Crowd paths, and never change a contract silently (CONTRACTS §9).
- Never start Genie, never push `--force`, never touch `main` or `demo`, never commit secrets.
- Never weaken, skip or delete a test.
- Write tests first. Run vitest and tsc before every push. Commit small with `[crowd] …` messages.
- Raw crowd text never reaches `/stage` or `/overlay`.
- Stage copy and scope cuts are Courtney's call.
- Courtney wants a short status update (done / in progress / next / blocked) at each quiet point, plus a status question to World and Brain on #2.
