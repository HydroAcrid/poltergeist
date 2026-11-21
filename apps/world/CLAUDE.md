# Lane: WORLD

**Mission:** build the floor everyone stands on (repo scaffold, hub, bus, deploys), then make the live Genie world reliable, recorded, haunt-able, and impossible to leave running.

## Owns
Root config (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vitest.workspace.ts`, lint config, `.gitignore`), `server/hub/**`, `scripts/**`, `.github/**`, `Dockerfile`, `.env.example`, `apps/world/**`, the contract files `common`, `envelope`, `registry`, `hub-types`, `episode`, `tick-request`, `haunt-injected` and `cost` together with their fixtures, and `fixtures/media/ep_real_*/**`.

## Produces
- C01, C02, C15 and C18 (the hub)
- C03 Episode
- C04 TickRequest
- C08 HauntInjected
- C13 CostLedger
- C16 artifacts: `episode.json`, `ended.json`, `video.webm`, `events.jsonl` (via the hub)

## Consumes
- C05 TickResponse
- C06 TickLog (for the thought bubble)
- C07 HauntDispatch
- C10 Scoreboard (shown via `/overlay`)
- C14 OperatorCommand

## Setup job (first, the other two lanes are waiting): push by H+0:20

A minimal version that runs is better than a complete one:

1. **Workspace:** pnpm workspace with `packages/contracts`, `server/hub`, `apps/world`, `apps/brain` and `apps/crowd`, each with its own `package.json`. Add shared tsconfig, vitest workspace projects (`contracts`, `world`, `brain`, `crowd`, `e2e`) and minimal ESLint.
2. **`packages/contracts`:** `common.ts`, `envelope.ts`, `registry.ts` (EventType → payload schema, plus `PayloadOf<T>`), `hub-types.ts`, `index.ts` (re-exports every contract file, tolerating files the other lanes haven't pushed yet), and `test/fixtures.test.ts`, which globs `fixtures/**` and runs every check in CONTRACTS §8.1.
3. **`server/hub`:**
   - Fastify plus `@fastify/websocket`.
   - A `Bus` that validates through the registry, broadcasts and keeps a ring buffer of history.
   - The recorder (`data/bus.jsonl` and `data/episodes/<id>/events.jsonl`).
   - The `/bus` WebSocket with token→source mapping.
   - `GET /api/bus/history` and `GET /data/*` (token).
   - A LaneModule loader using `PG_WORLD|BRAIN|CROWD=real|fake` (default `fake`). If a lane's module file is missing, load a no-op module and log a warning, so the hub always boots.
   - Static serving for the built web apps.
   - Health polling every 10 s, publishing `lane.health`.
4. **`scripts/`:**
   - `check-ownership.sh`: reads `PG_LANE`, gets staged paths, rejects any outside the SPEC §4 globs unless the commit message contains `[contract-migration]` (check it in a `commit-msg` hook).
   - `inbox.ts`: prints messages to `$PG_LANE` or `all` that come after the cursor.
   - `msg.ts`: appends a correctly formatted message with the next id.
   - `status.ts`: prints all three status files plus how many unread messages each lane has.
   - `proof.ts`: a stub that crowd will fill in.
5. **Git hooks** (`simple-git-hooks`): `pre-commit` runs the ownership check, `commit-msg` handles the migration tag, and `pre-push` runs `pnpm check`.
6. **Root scripts:** `dev`, `build`, `check`, `test`, `test:contracts`, `e2e:fake`, `e2e:pair`, `inbox`, `msg`, `status`, `proof`, `fixtures:export`.
7. **The rest:** `.github/workflows/check.yml` (`pnpm check` on push to `main`), a `Dockerfile` (node:20-slim plus ffmpeg), `.env.example` (already provided; keep it in sync), and a README with how to run it.

## Genie adapter (VERIFY against the official docs and cookbook at H+0:00, then record the real names here)

Secondary sources describe the flow as below. **Verify every step:**
1. The server creates an interaction with model `PG_MODEL_GENIE` through the Interactions API (v1beta).
2. The server mints an ephemeral token scoped to that interaction. A cookbook PR reportedly uses `client.interactions.auth_tokens.create`.
3. The browser connects over WebRTC and sends **one** `world_setup` event containing the prompt, the image or both.
4. The browser steers with `user_action` key down/up events and **text input** events.
5. The session closes explicitly with `complete()` or `cancel()`.

Constraints reported so far:
- Output is 720p at 24 fps.
- Sessions are capped at 120 s, and coherence is best in roughly the first 45–90 s.
- The seed JPEG should be under about 48 KB (the WebRTC control channel is reportedly limited to about 64 KB).
- **Billing continues until the session is explicitly closed.**

```ts
// server
interface GenieAdapter {
  create(req: { seed: Episode["seed"]; maxDurationMs: Ms }): Promise<SessionGrant>;
  end(sessionId: Id, reason: string): Promise<{ closedCleanly: boolean }>;   // idempotent
}
// browser
interface GenieClient {
  connect(grant: SessionGrant): Promise<MediaStream>;
  setup(seed: Episode["seed"]): Promise<void>;
  hold(key: Key, ms: Ms): Promise<void>;   // key down → wait → key up; releases any held key first
  text(prompt: string): Promise<{ ok: boolean; error?: string }>;
  close(): Promise<void>;
}
// world-internal
interface SessionGrant { sessionId: Id; interactionId: string; transport: "webrtc" | "websocket";
  ephemeralToken: string; tokenExpiresAt: EpochMs; maxDurationMs: Ms; hardKillAt: EpochMs }
```

**Broker rules** (unit-test every one with `FakeGenieAdapter`):
- At most one active session per instance. A second request gets `BUSY`.
- Enforce the caps from SPEC §6 (`CAP_SESSIONS`, `CAP_USD`).
- Real Genie requires `PG_ALLOW_GENIE=1` on local; staging and prod always allow it.
- **Watchdog:** `hardKillAt = startedAt + maxDurationMs + 5000`. Also, `/stage` sends a heartbeat every 2 s, and three missed heartbeats end the session.
- **`end()` must be called on every exit path:**
  - success
  - timeout
  - operator stop
  - an error thrown anywhere
  - a WebSocket disconnect
  - SIGTERM / `LaneModule.close()`
  - the watchdog
- Publish `cost.updated` every 5 s while a session is active, and whenever one ends.

## `/stage` page (the main screen)

- **Layout:**
  - Full-screen video.
  - The `/overlay` iframe on top (crowd's kill feed, scoreboard and QR).
  - World's own thought bubble: the target dot, the box, `rationale` and `mode`, drawn from `tick` events.
  - A small cost and latency HUD that hides in finals mode.
- **Tick loop:**
  - Every 500 ms, draw the video to a 640×360 canvas.
  - Encode a JPEG at quality 0.7 (target ≤ 60 KB).
  - Compute `frameDiff` on a 32×18 grayscale copy.
  - Send a `TickRequest`, respecting the flow control in C04.
  - If `driver === "brain"`, apply `action` with `GenieClient.hold`. Never hold two movement keys at once.
- **Hauntings:** on `haunt.dispatch` for the current episode, call `GenieClient.text(text)`, then publish `haunt.injected` with the current `t`.
- **Recording:** use MediaRecorder on the video stream with a 5 s timeslice, and upload chunks to `/api/world/episode/:id/video?part=n`. The server concatenates them into `video.webm`.
- **Episode end:** two consecutive `successClaim`s → `success_claim`; `maxDurationMs` reached → `timeout`. Then call `end()`, write `ended.json` and publish `episode.ended`.
- **Hotkeys:**
  - `R`: replay mode on the best episode (chosen in `/operator`, or the latest successful one)
  - `K`: kill
  - `M`: manual driving (`driver: "human"`, arrow keys and WASD pass straight through)
  - `F`: finals layout
- **Modes:**
  - **replay:** `<video src=/data/episodes/<id>/video.webm>`. Same tick loop, injected hauntings are `simulated: true`, and a "REPLAY" badge shows.
  - **webcam:** `getUserMedia` replaces the Genie stream. A dispatched haunting is shown as a large on-screen dare, and `haunt.injected` fires when the operator sends `haunt.dareDone`.
- **Seed photo:** `POST /api/world/seed-image` re-encodes on the server with ffmpeg or sharp. Max width 1280; step quality down until the file is ≤ 48 KB.

## `pnpm fixtures:export --episode <id>`

Copies `episode.json`, `ended.json`, `events.jsonl` and every 2nd frame into `fixtures/media/ep_real_NNN/`, and re-encodes the video to 480p (≤ 5 MB). Then post a `NOTICE → all`.

## Gotchas

- WebRTC needs a secure context, so use HTTPS when deployed and `localhost` in dev.
- If a canvas grab of the WebRTC `<video>` ever comes back tainted or black, switch to the WebSocket transport and decode on the server. Tell your human.
- Hosts with WebSocket idle timeouts need a ping every 20 s, and clients must auto-reconnect.
