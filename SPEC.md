# Poltergeist: Build Spec v1

> The crowd red-teams an embodied AI agent inside a live Genie 4 world.
> Frozen at H+0:30. Changes need agreement from all three lane leads.

**Read order for every agent:** `CLAUDE.md` → `SPEC.md` → `CONTRACTS.md` → `apps/<your lane>/CLAUDE.md` → `apps/<your lane>/TODO.md`

---

## 1. Product in one paragraph

Genie 4 generates a live, first-person world from a photo, for example a hallway with an EXIT sign at the end. An AI player watches the world through frames. Its eyes are Gemini Robotics-ER 2 and its hands are a deterministic controller. It presses keys to walk to the target. Attendees use their phones to submit "hauntings" (fog, a power cut, a tour group blocking the hall). Each haunting is moderated and then injected into the live world as a Genie text event. A referee decides who caused each failure:
- **adversary:** a haunting caused it
- **agent:** a bug in the player
- **world:** Genie forgot something

A Managed Agent coach studies the failures and proposes changes to the player's policy. A CI gate promotes a change only if held-out replay accuracy improves.

**Why it wins:** it wasn't possible last week, because the Genie 4 API opened Nov 19. The whole room plays. Blame attribution is a real technical problem, and the Managed Agent coach is a natural fit for the Managed Agents prize.

## 2. The demo path

The demo path is everything below working at once on `/stage`:
- a live episode
- the player's thought bubble (where it thinks the target is, plus a short reason)
- phones haunting the world
- the kill feed updating
- a verdict appearing after each episode

**Every push must keep `pnpm e2e:fake` green. Feature work never breaks the demo path.**

## 3. Architecture

```
 phones ── POST /api/crowd/haunt ──► [crowd] moderation (Hydrogen) → queue → scheduler
                                                              │ haunt.dispatch (bus)
 /operator ── operator.command (bus) ─────┐                   ▼
                                          ├──► [world] broker ──► Genie 4 session (Live Interactions, WebRTC)
                                          │       ▲ ephemeral token            │ 720p video
                                          │       │                            ▼
                                          │    /stage page: frame grab 2 Hz ── POST /api/brain/tick ──► [brain] perception (ER 2)
                                          │       │  key holds ◄──────────── TickResponse ◄───────────── + controller
                                          │       │  haunt text → Genie → haunt.injected (bus)                 │ tick (bus)
                                          │    recorder → data/episodes/<id>/video.webm                        ▼
                                          │                                              [crowd] referee: rule → verdict.provisional
                                          │                                              Neon → verdict.final → scoreboard → /overlay
                                          └──► [brain] replay eval + /mcp ◄── Managed Agent coach (Carbon) → policy.promoted
 hub (world): Fastify + WebSocket bus (/bus) + recorder (events.jsonl) + static pages + /data
```

**There is one deployable.** A single Node process (the *hub*) serves the APIs, the WebSocket bus, the web pages, `/data` and `/mcp`. Each lane plugs in as a `LaneModule` (see CONTRACTS C18), either `real` or `fake`, chosen with `PG_WORLD`, `PG_BRAIN` and `PG_CROWD`. State lives in memory plus `PG_DATA_DIR`, which must be on a persistent volume.

**Stack (fixed, so three agents don't drift apart):**
- **Language and packages:** TypeScript, Node 20+, pnpm workspaces.
- **Server:** Fastify with `@fastify/websocket`.
- **Testing and contracts:** zod for contracts, vitest for tests.
- **Front end:** Vite + React for the web apps (`/stage` may be plain TS).
- **APIs:** `@google/genai` for Gemini (fall back to REST if the SDK lags).
- **Video:** ffmpeg on the server.

## 4. Lanes and ownership

| Lane | Mission | Owns (only this lane edits) |
|---|---|---|
| **world** | Genie session, the stage screen, recording, infrastructure | root config, `server/hub/**`, `scripts/**`, `.github/**`, `Dockerfile`, `.env.example`, `apps/world/**`, `packages/contracts/src/{common,envelope,registry,hub-types,episode,tick-request,haunt-injected,cost}.ts`, the fixtures for those contracts, `fixtures/media/ep_real_*/**` |
| **brain** | Perception, controller, replay eval, MCP, coach | `apps/brain/**`, `packages/contracts/src/{tick-response,tick-log,policy,replay}.ts`, the fixtures for those contracts, `fixtures/scenarios/**`, `fixtures/media/fixture-zero/**` |
| **crowd** | Phones, moderation, scheduler, referee, scoreboard, operator console, overlay | `apps/crowd/**`, `packages/contracts/src/{haunt,verdict,scoreboard,operator}.ts`, the fixtures for those contracts |
| each lane | Its own comms | `comms/outbox/<lane>.md`, `comms/status/<lane>.json`, `comms/cursor/<lane>.json` |
| humans only | Shared docs | `SPEC.md`, `CONTRACTS.md`, `CLAUDE.md`, `KICKOFF.md`, `.claude/**` |

A pre-commit hook (`scripts/check-ownership.sh`, using `PG_LANE`) rejects commits that touch paths your lane doesn't own. The only exception is an agreed contract migration (CONTRACTS §9).

**Isolation works at two levels.** Between lanes: each laptop has its own clone, and only pushes to `main` are shared. Inside a lane: up to 2 extra git worktrees on short-lived `<lane>/<topic>` branches, which the lane's primary session merges (see "Parallel agents inside one lane" in `CLAUDE.md`).

**Web pages:**
- world: `/stage`
- crowd: `/haunt` (phones), `/operator`, `/overlay` (an iframe over `/stage`)
- brain: `/brain/debug`, `/brain/label`

## 5. Model routing

All model IDs are set through env vars. **Verify every ID at kickoff.**

| Job | Env var | Default |
|---|---|---|
| World | `PG_MODEL_GENIE` | `genie-4` |
| Player perception (points at the target and hazards) | `PG_MODEL_PERCEPTION` | `gemini-robotics-er-2-preview` (alternatives: `gemini-4-hydrogen`, `gemini-4-neon`) |
| Moderation and rewriting of hauntings | `PG_MODEL_MODERATION` | `gemini-4-hydrogen` |
| Live referee (final verdict) | `PG_MODEL_REFEREE` | `gemini-4-neon` |
| Dispute review, replay labels | `PG_MODEL_AUDIT` | `gemini-4-argon` |
| Coach (Managed Agent) | `PG_MANAGED_AGENT` | latest Antigravity managed agent, running on Carbon (check the docs) |

## 6. Guardrails

1. **Genie only goes through the world broker.**
   - One active session per instance.
   - A daily spending budget, plus a maximum duration per session.
   - A watchdog ends any session at `hardKillAt`.
   - Every end path calls Genie's explicit close (`complete()` or `cancel()`). Closing a browser tab does **not** stop billing.
   - Real sessions start only from `/operator` (a human click), or from the world laptop with `PG_ALLOW_GENIE=1`.
2. **Spending and timeout settings by instance.** End each run as soon as the requested evidence is captured.

   | Instance | Daily USD budget | Max duration |
   |---|---|---|
   | local (world laptop) | $40 | 60 s |
   | staging | $80 | 60 s |
   | prod | $260 | 90 s |

3. **No paid APIs in tests.** Live calls exist only in tests tagged `@live`, which run only with `PG_LIVE=1`, and only a human runs them.
4. **No secrets in git.** `GEMINI_API_KEY` lives in `.env` locally and in host secrets in the cloud.
5. **Safety:**
   - Raw crowd text never reaches `/stage` or `/overlay`. Only moderated text, shown by nickname.
   - Finals run in approval mode: an operator approves every haunting.

## 7. Environments and deploys

| Env | Source | Genie | Who deploys |
|---|---|---|---|
| local | your checkout | fakes by default | you |
| staging | `main` (auto-deploy) | yes, staging caps | automatic |
| prod (the demo) | `demo` branch (auto-deploy) | yes, prod caps | **humans only:** fast-forward `demo` ← `main` at a huddle, after a green `pnpm check` plus a 1-minute smoke test |

GitHub Actions runs `pnpm check` on every push to `main`. If `main` goes red, whoever broke it fixes or reverts it within 10 minutes.

## 8. Timeline and tiers (H = hacking start; clock assumes 10:00, so shift to the real agenda)

| Checkpoint | Must be true |
|---|---|
| **H+0:20** | Scaffold on `main`: the hub boots, the bus works, the contracts package exists, scripts and hooks are in place |
| **H+0:30** | All v1 contracts and fixtures are on `main`; `pnpm test:contracts` is green; tag `contracts-v1` |
| **H+1:00** | All three fakes exist; `pnpm e2e:fake` is green on `main`; staging and prod are deployed |
| **H+1:30, Tier 0** | A real Genie round from `/operator`: video on `/stage`, ticks flowing, a human can drive. Export `fixtures/media/ep_real_001` |
| **H+2:30, Tier 1** | An autonomous player plus preset hauntings injected into the live world, a provisional verdict, and the kill feed |
| **H+3:00** | **Haunting rounds start:** at :00, :15, :30 and :45, open to attendees, with recruiting in progress |
| **H+4:30, Tier 2** | Phones live with moderation; the Neon final verdict; scoreboard; seed photos; replay mode; a replay eval set. **Record the backup video.** |
| **H+6:00, Tier 3 + FREEZE** | The coach ships ≥1 policy through the gate. After this point: bug fixes, failure drills and rehearsal only |

**Huddles** happen at :20 and :50 (5 min), with promotion to prod decided there. Never promote within 5 minutes of a haunting round.

## 9. Cut rules (cut scope; never move a deadline)

- **H+1:30, no real Genie frames:** switch the world to `mode: "webcam"`. A webcam replaces Genie, hauntings become physical dares that the operator marks done, and the rest of the pipeline is unchanged.
- **H+2:30, the autonomous loop is unreliable:** switch to `driver: "human"`. A human drives, and the brain only perceives. Scoreboard success then means perception accuracy under hauntings.
- **H+4:30, the coach hasn't started:** drop Tier 3. Show a hand-written v2 policy going through the same gate instead.

## 10. Failure drills (rehearse after freeze)

| Trigger | Operator action |
|---|---|
| The Genie session doesn't start within 8 s | Press `R` on `/stage` to enter replay mode on the best recorded episode. The brain still runs live on its frames, and a "REPLAY" badge shows. |
| Fewer than 5 crowd hauntings | Release seeded hauntings from `/operator` |
| Wi-Fi dies | Switch to the backup laptop on a hotspot |
| Nothing works | Play the backup video |
| A runaway session | Press `K` on `/stage` (kill), plus the watchdog |

## 11. Proof numbers we must be able to show (`pnpm proof` → `data/proof.json`)

- unique attackers; hauntings submitted, approved, injected and landed
- episodes and the success rate
- blame split (adversary / agent / world)
- top tags by landed hauntings
- policy versions, with held-out hit rate before and after each promotion
- perception latency (p50 and p95)
- Genie seconds and dollars spent

## 12. Glossary

| Term | Meaning |
|---|---|
| **episode** | One Genie session, at most 90 s |
| **round** | A scheduled public episode |
| **tick** | One perceive-and-act step, about 2 Hz |
| **haunting** | A crowd-submitted world event |
| **landed** | A haunting that the verdict blames for a failure |
| **demo path** | §2 |
