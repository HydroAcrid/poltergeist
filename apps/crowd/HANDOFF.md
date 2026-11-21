# Crowd lane handoff (Courtney → Kevin)

Branch `crowd/haunt-flow`. Everything below is pushed. 135 crowd tests pass and the root `pnpm check` passes. Courtney is out of session credits, so this is everything needed to finish Crowd's part.

## Run it

```sh
cd apps/crowd
pnpm install --ignore-workspace --allow-build esbuild
pnpm check                       # typecheck + 135 tests
PORT=8788 pnpm dev               # stand-in hub: /haunt, /overlay?bg=1, /dev (start/end round)
```

`pnpm dev` runs Crowd's stand-in hub (`dev/dev-hub.ts`): an in-memory bus, a stand-in World that acks each dispatch after 0.8 s, and a **dev-only** `/rehearsal/state` that walks each haunting through acked → seen (+1.5 s) → in path (+3 s) → reacted (+5 s) while the robot drifts left to right. With Crowd's two keys in `~/.config/poltergeist/crowd.env` (see [docs/gemini-keys.md](docs/gemini-keys.md)) it uses Gemini moderation with failover; otherwise it's rules-only.

## What's done

| Area | Where | Notes |
|---|---|---|
| Contracts and fixtures | `packages/contracts/src/{haunt,verdict,scoreboard,operator}.ts`, `fixtures/{haunt,haunt-public,haunt-dispatch,verdict,scoreboard,operator-command}/` | Haunt@1.5.0 (your suggestion/`revisionOf`/HauntReceipt included). World-owned files are stubbed in `test/shims/contracts/`; delete those once the shared scaffold lands. |
| Phone `/haunt` | `web/haunt.html` | Screens: Haunt (3 suggestions, "+ More ideas", Speak), More ideas, **Sent!** (landing page after any send, incl. your revise flow), Up next, Hallway, Mine. Bottom tabs, ghost names, hash routing. Delivery says "Sent to the hallway". |
| Server | `server/crowd.ts`, `routes.ts`, `index.ts`, `fake.ts`, `ghost-names.ts`, `moderation/{rules,gemini}.ts` | FIFO queue plus scheduler (t ≥ 8 s, every 12 s, max 6, reserve-once, seeded fallback, deadline guard), rate limits, assigned ghost names, private receipts, `hallway` list, real and fake LaneModules. |
| Projector `/overlay` | `web/overlay.html`, `web/overlay-model.js` | Transparent, for layering over `/stage`. One card opposite the robot's last reliable position, or a top-margin status line when stale. Pills for round, time left and scares. Server-side join QR (big in opening/result, small Join in play). Result banner. `?drawer=1` operator queue. `?world=<origin>` if `/rehearsal/state` lives elsewhere. |
| Conductor v0 | `server/conductor.ts`, `docs/conductor.md` | Rules, trace, fallback ladder (agent → rules → FIFO). **Not wired into the scheduler** (needs scene data). |
| "Seen" fallback | `server/seen.ts` | Tick-hazard rule; matches Brain's `hazard-after-haunt` / `no-hazard-after-haunt`. Not wired yet. |

Screenshots are in `docs/`: `phone-*.jpg`, `overlay-*.jpg`, `projector-*.jpg`, and `haunt-phone-happening.jpg`.

## Left to do (in priority order)

1. **Plug Crowd into your rehearsal host** (`codex/team-world-rehearsal`): mount `server/index.ts` (or the routes) in your process so `/haunt`, `/overlay` and `/api/crowd/*` are same-origin with `/rehearsal/state`.
2. **Match the overlay adapter to your real state body.** Only `normalizeRehearsal()` in `web/overlay-model.js` knows your field names. Today it reads `round.{phase, now, deadline, fear, trackedFeet[y,x], trackedAt, props[].{hauntId|id, acked, seen, inPath, reactedAt, reaction}}`. Add your captured bodies as test fixtures in `test/overlay-model.test.ts`.
3. **Remove the shims** in `test/shims/contracts/` once `common/episode/haunt-injected/hub-types` are on `main`. Then merge `crowd/haunt-flow` → `main`.
4. **Wire the conductor** (`conduct()` + `withAgent()`) into `CrowdService.tick()` once `scene.observed` exists. Until then FIFO stays the behavior.
5. **Scares:** count `TickLog.reaction === "stumble"` within 6 s of a seen, injected haunting (one per haunting; never `avoid`/`unclear`). This is waiting on Brain's TickLog 1.1.0 and the stumble/avoid/unclear fixtures.
6. **Referee rule + scoreboard** (TODO Tier 1), against Brain's six scenario bundles.
7. **Your ghost-veil art request for the opening:** not started.
8. **Physical-phone checks:** Speak (Web Speech API), the real Gemini revise path, and the QR scan to `/haunt`.
9. **Housekeeping:** `apps/crowd/TODO.md` and `comms/status/crowd.json` were not ticked (worktree rule). Update them when merging.

## Rules kept throughout

- Raw text, device ids and rejection reasons and suggestions never leave Crowd (`HauntPublic` is strict; bus tests check this).
- "Sent to the hallway" means delivery only. "In the hallway" or reaction credit needs camera evidence.
- The only display text is `moderated.text`, plus the ghost name.
