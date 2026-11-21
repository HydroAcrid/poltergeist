# Poltergeist: Contracts v1.0.0

These are the only shapes allowed to cross a lane boundary. If a change isn't written here, it isn't a contract change; it belongs inside a lane.

## 1. Principles

1. **Contracts use our own types only.** Vendor APIs (Genie events, ER 2 output, the Managed Agents API) live behind lane-internal *adapters* and never leak into contracts. Vendor uncertainty stays inside one lane.
2. **The producer owns the schema file and its fixtures. Consumers own their tests against the producer's fixtures.** A consumer that needs a new case sends a `FIXTURE-REQUEST` (see `CLAUDE.md`).
3. **zod is the source of truth.** Each contract lives in `packages/contracts/src/<file>.ts` and exports the zod schema, the inferred type and a `VERSION` constant. The TypeScript below is normative: the zod schemas must match it exactly, and ranges in comments are enforced.
4. **Validate at every boundary.**
   - The hub validates every bus envelope.
   - HTTP handlers validate requests.
   - Clients validate responses in dev and test.
   - An invalid message is rejected and logged; it is never silently coerced.
5. **Paid services sit behind adapter seams** so contract and pair tests run for free (see §8).

## 2. Conventions

- `Ms` is integer milliseconds. `t` is **ms since episode start**, measured by the `/stage` page clock: `performance.now()` minus the episode start. `ts` and `*At` fields are epoch ms.
- IDs are prefixed ULIDs: `ep_` (episode), `ss_` (session), `ht_` (haunting), `ev_` (envelope), `fr_` (replay frame).
- `Point = [y, x]` and `Box = [ymin, xmin, ymax, xmax]` are integers normalized to 0–1000 with the origin at top-left, matching Gemini's spatial output.
- Strings shown on screen have hard length limits (see the fields below).
- Every contract file exports `VERSION = "1.0.0"`.

## 3. Catalog

| ID | Contract | Producer | Consumers | Transport | File |
|---|---|---|---|---|---|
| C01 | Common types | world | all | n/a | `common.ts` |
| C02 | Envelope + event registry | world | all | WS `/bus` | `envelope.ts`, `registry.ts` |
| C03 | Episode, EpisodeEnded | world | brain, crowd | bus | `episode.ts` |
| C04 | TickRequest | world | brain | HTTP `POST /api/brain/tick` | `tick-request.ts` |
| C05 | TickResponse, Perception, Action | brain | world | HTTP response | `tick-response.ts` |
| C06 | TickLog | brain | crowd, world | bus `tick` | `tick-log.ts` |
| C07 | Haunt, HauntPublic, HauntDispatch | crowd | world, brain | bus, HTTP | `haunt.ts` |
| C08 | HauntInjected | world | crowd, brain | bus | `haunt-injected.ts` |
| C09 | Verdict | crowd | all | bus | `verdict.ts` |
| C10 | Scoreboard | crowd | world | bus, HTTP | `scoreboard.ts` |
| C11 | PolicyPromoted, EvalSummary | brain | crowd | bus | `policy.ts` |
| C12 | ReplayFrame, ReplayEvalRequest, ReplayEvalResult | brain | crowd (proof) | HTTP, files | `replay.ts` |
| C13 | CostLedger | world | crowd | bus, HTTP | `cost.ts` |
| C14 | OperatorCommand | crowd (builds `/operator`) | world, brain, crowd | bus | `operator.ts` |
| C15 | LaneHealth, BusError | world (hub) | crowd | bus | `envelope.ts` |
| C16 | Episode artifacts (file layout) | world + brain + crowd | all | files, `/data` | this document |
| C17 | HTTP endpoint table | each owner | callers | HTTP | this document |
| C18 | LaneModule, HubContext, Bus | world | every lane implements it | TS interface | `hub-types.ts` |

## 4. Definitions

### C01 Common (`common.ts`, world)

```ts
export type Lane = "world" | "brain" | "crowd";
export type Source = Lane | "operator" | "hub";
export type Ms = number;          // int ≥ 0
export type EpochMs = number;     // int
export type Id = string;          // prefixed ULID
export type Point = [y: number, x: number];                                  // ints 0..1000
export type Box = [ymin: number, xmin: number, ymax: number, xmax: number];  // ints 0..1000, ymin<ymax, xmin<xmax
export type Key = "W" | "A" | "S" | "D" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "NOOP";
export type HauntTag = "visibility" | "lighting" | "occlusion" | "geometry" | "distractor"
                     | "sign_change" | "weather" | "audio" | "other";
export type Blame = "adversary" | "agent" | "world";
export type WorldMode = "genie" | "webcam" | "replay";
export type Driver = "brain" | "human";
export type Instance = "local" | "staging" | "prod";
```

### C02 Envelope (`envelope.ts`, world) + registry (`registry.ts`, world)

```ts
export interface Envelope<T extends EventType = EventType> {
  v: 1;
  id: Id;               // ev_…
  type: T;
  ts: EpochMs;          // stamped by hub
  source: Source;       // stamped by hub from the connection's token
  episodeId?: Id;
  payload: PayloadOf<T>;
}
```

| `type` | Payload | Producer | Consumers |
|---|---|---|---|
| `episode.started` | `Episode` | world | brain, crowd |
| `episode.ended` | `EpisodeEnded` | world | brain, crowd |
| `tick` | `TickLog` | brain | crowd, world |
| `haunt.public` | `HauntPublic` (on every status change) | crowd | world, crowd |
| `haunt.dispatch` | `HauntDispatch` | crowd | world |
| `haunt.injected` | `HauntInjected` | world | crowd, brain |
| `verdict.provisional` | `Verdict` | crowd | all |
| `verdict.final` | `Verdict` | crowd | all |
| `policy.promoted` | `PolicyPromoted` | brain | crowd |
| `scoreboard.updated` | `Scoreboard` | crowd | world |
| `cost.updated` | `CostLedger` | world | crowd |
| `operator.command` | `OperatorCommand` | operator (via `/operator`) | world, brain, crowd |
| `lane.health` | `LaneHealth` | hub (polls modules every 10 s) | crowd |
| `bus.error` | `BusError` | hub | the sender only |

**How the bus behaves:**
- **Delivery and ordering:** delivery is at most once. Ordering is guaranteed per source connection only.
- **Consumers must be idempotent** by `id` and must tolerate gaps in `tick.seq`.
- **WebSocket:**
  - Clients connect with `GET /bus?types=a,b&token=<token>`.
  - The server pushes one `Envelope` as JSON per message.
  - Clients publish by sending `{ type, payload, episodeId? }`; the hub stamps `v`, `id`, `ts` and `source` after validating.
  - Publishing requires a token: `PG_TOKEN_WORLD`, `PG_TOKEN_BRAIN`, `PG_TOKEN_CROWD` or `PG_TOKEN_OPERATOR`. The token determines `source`.
  - **Phones never get a token.**
- **Server-side modules** publish in-process with `bus.publish(...)`.
- **The hub recorder** appends every envelope that has an `episodeId` to `data/episodes/<id>/events.jsonl`, and every envelope to `data/bus.jsonl`.

```ts
export interface LaneHealth { lane: Lane; kind: "real" | "fake"; ok: boolean; detail?: string }
export interface BusError { rejectedType: string; reason: string }
```

### C03 Episode (`episode.ts`, world)

```ts
export interface Episode {
  episodeId: Id;
  sessionId: Id | null;          // null in replay mode
  mode: WorldMode;
  driver: Driver;                // "human" = brain perceives only, its actions are not applied
  replayOf?: Id;                 // replay mode: source episode
  seed: { kind: "text" | "image" | "both"; prompt: string; imagePath?: string };   // prompt ≤ 400 chars
  task: { targetLabel: string; instruction: string };   // ≤ 40 / ≤ 140 chars, e.g. "EXIT sign", "Walk to the exit door at the end of the hallway"
  policyVersion: string;         // e.g. "v1"
  round?: number;
  startedAt: EpochMs;
  maxDurationMs: Ms;             // single provider session, ≤ 90000
  match?:                        // one episode ID across all provider sessions
    | { clockMode: "active"; durationMs: Ms }
    | { clockMode: "wall"; durationMs: Ms; deadline: EpochMs };
}
export interface EpisodeEnded {
  episodeId: Id;
  endedAt: EpochMs;
  durationMs: Ms;
  reason: "success_claim" | "timeout" | "operator_stop" | "error" | "watchdog";
  error?: string;
  genieClosedCleanly: boolean | null;   // null in replay/webcam
  artifacts: { eventsPath: string; framesDir: string; videoPath?: string };
}
```

### C04 TickRequest (`tick-request.ts`, world → brain)

```ts
export interface TickRequest {
  episodeId: Id;
  seq: number;                   // 0,1,2,… strictly increasing per episode
  t: Ms;                         // frame capture time
  driver: Driver;
  frame: { mime: "image/jpeg"; width: number; height: number; b64: string };   // 640×360 recommended; b64 ≤ 80_000 chars
  frameDiff: number;             // 0..1 mean abs diff vs previous captured frame, 32×18 grayscale
  executing?: { key: Key; holdMs: Ms; startedT: Ms };   // action currently held, if any
  recentHaunts: { hauntId: Id; t: Ms; tags: HauntTag[] }[];   // injected in the last 10 s
}
```

**Behavioral contract:**
- world sends the next `TickRequest` only after the previous response arrives, or after 3000 ms.
- world drops any response whose `seq` is lower than the last one it applied.
- brain must respond within 3000 ms, returning `mode: "fallback"` if its own perception times out.

### C05 TickResponse (`tick-response.ts`, brain → world)

```ts
export interface Perception {
  visible: boolean;
  point?: Point;                 // required iff visible
  box?: Box;
  conf: number;                  // 0..1
  hazards: { label: string; point?: Point }[];   // ≤ 5, label ≤ 30 chars
  model: string;
  latencyMs: Ms;
  error?: "timeout" | "parse" | "api";
}
export interface Action { key: Key; holdMs: Ms }   // 0..1500; NOOP ⇒ holdMs 0
export interface TickResponse {
  episodeId: Id;
  seq: number;                   // echo
  t: Ms;                         // echo
  perception: Perception;
  action: Action;                // world ignores it when driver = "human"
  mode: "track" | "search" | "unstick" | "success" | "fallback";
  rationale: string;             // ≤ 60 chars, shown in the thought bubble
  successClaim: boolean;
  policyVersion: string;
  brainLatencyMs: Ms;
}
```

### C06 TickLog (`tick-log.ts`, brain → bus `tick`)

```ts
export interface TickLog {
  episodeId: Id; seq: number; t: Ms; driver: Driver;
  framePath: string;             // data/episodes/<id>/frames/<seq>.jpg (written by brain)
  frameDiff: number;
  perception: Perception;
  action: Action;
  mode: TickResponse["mode"];
  rationale: string;
  successClaim: boolean;
  policyVersion: string;
}
```

### C07 Haunt (`haunt.ts`, crowd)

```ts
export type HauntStatus = "submitted" | "rejected" | "approved" | "queued" | "dispatched" | "injected" | "failed";
export interface Haunt {
  hauntId: Id;
  deviceId: string;              // anonymous cookie id; never leaves crowd except to /operator
  displayName?: string;          // ≤ 16 chars, moderated
  raw: string;                   // ≤ 80 chars; NEVER rendered on /stage or /overlay
  preset?: string;               // preset id if tapped
  status: HauntStatus;
  moderated?: { safe: boolean; text: string; tags: HauntTag[]; reason?: string; suggestion?: string; model: string };   // text ≤ 60 chars
  votes: number;
  seeded: boolean;               // pre-approved fallback pool
  episodeId?: Id;
  injectedT?: Ms;
  createdAt: EpochMs;
}
export type HauntReceipt = Omit<Haunt, "raw" | "deviceId">; // author only; optional reason and suggestion ≤ 80 chars
export type HauntPublic = Omit<HauntReceipt, "moderated"> & {
  moderated?: Omit<NonNullable<Haunt["moderated"]>, "reason" | "suggestion">;
};
export interface HauntDispatch { hauntId: Id; episodeId: Id; text: string; tags: HauntTag[] }   // text = moderated.text
```

A phone can submit a text revision with the rejected idea’s ID in `revisionOf`. The author may immediately revise their most recent original once. Each revision goes through moderation and counts toward the daily limit. Repeating the same revision returns its existing receipt.

### C08 HauntInjected (`haunt-injected.ts`, world)

```ts
export interface HauntInjected {
  hauntId: Id; episodeId: Id;
  t: Ms;                         // when the text event was sent to Genie (or shown as a dare in webcam mode)
  ok: boolean;
  simulated: boolean;            // true in replay mode and in fakes
  error?: string;
}
```

### C09 Verdict (`verdict.ts`, crowd)

```ts
export interface Verdict {
  episodeId: Id;
  stage: "provisional" | "final";
  outcome: "success" | "failure" | "aborted";
  failureT?: Ms;                 // required iff outcome = failure
  blame?: Blame;                 // required iff outcome = failure
  culpritHauntId?: Id;           // required iff blame = adversary
  ruleBlame?: Blame;             // what the deterministic rule said
  overrodeRule: boolean;
  evidence: { t: Ms; note: string }[];   // ≤ 5, note ≤ 80 chars
  confidence: number;            // 0..1
  model?: string;                // "rule" or the model id
  createdAt: EpochMs;
}
```

### C10 Scoreboard (`scoreboard.ts`, crowd)

```ts
export interface Scoreboard {
  updatedAt: EpochMs;
  rounds: number; episodes: number; successes: number;
  attacks: { submitted: number; approved: number; injected: number; landed: number };
  uniqueAttackers: number;
  topAttackers: { displayName: string; landed: number }[];                  // ≤ 5
  topTags: { tag: HauntTag; injected: number; landed: number }[];
  blame: { adversary: number; agent: number; world: number };
  policy: { version: string; heldoutHitRate?: number };
  killFeed: { ts: EpochMs; text: string }[];                                // ≤ 8, display-safe, ≤ 90 chars each
}
```

### C11 Policy (`policy.ts`, brain)

```ts
export interface EvalSummary { n: number; hitRate: number; byTag: Partial<Record<HauntTag, { n: number; hitRate: number }>> }
export interface PolicyPromoted {
  version: string; parent: string;
  createdBy: "human" | "coach";
  rationale: string;             // ≤ 140 chars
  eval: { heldout: EvalSummary; clean: EvalSummary; parentHeldout: EvalSummary; parentClean: EvalSummary };
  promotedAt: EpochMs;
}
```

The `policy.yaml` format is internal to brain (see `apps/brain/CLAUDE.md`).

### C12 Replay (`replay.ts`, brain)

```ts
export interface ReplayFrame {
  frameId: Id; episodeId: Id; seq: number; t: Ms; path: string;
  label: { visible: boolean; point?: Point };
  labelSource: "audit_model" | "human";
  tags: HauntTag[];              // tags of hauntings injected in the 10 s before t
  split: "train" | "heldout";    // split BY EPISODE (never by frame)
  clean: boolean;                // no haunting in the previous 10 s
}
export interface ReplayEvalRequest { policyVersion?: string; policyYaml?: string; split: "train" | "heldout" | "clean"; limit?: number }
export interface ReplayEvalResult {
  policyVersion: string; split: "train" | "heldout" | "clean";
  n: number; hitRate: number; meanPointErr?: number;
  byTag: EvalSummary["byTag"];
  latencyP50: Ms; latencyP95: Ms; ranAt: EpochMs;
}
```

A **hit** means the predicted `visible` equals the labeled `visible`, and, if visible, the predicted point is within 80 units (Euclidean, in 0–1000 space) of the labeled point.

### C13 CostLedger (`cost.ts`, world)

```ts
export interface CostLedger {
  instance: Instance;
  day: string;                   // YYYY-MM-DD, America/New_York
  sessionsStarted: number; sessionsActive: number;
  genieSeconds: number; estUsd: number;   // estUsd = genieSeconds × PG_GENIE_USD_PER_SEC
  caps: { sessions: number; usd: number; maxDurationMs: Ms };
  lastSession?: { sessionId: Id; startedAt: EpochMs; endedAt?: EpochMs; closedCleanly?: boolean };
}
```

### C14 OperatorCommand (`operator.ts`, crowd)

```ts
export type OperatorCommand =
  | { cmd: "round.start"; seed: Episode["seed"]; task: Episode["task"]; driver?: Driver; maxDurationMs?: Ms; round?: number }
  | { cmd: "round.stop"; episodeId: Id }
  | { cmd: "replay.start"; sourceEpisodeId: Id }
  | { cmd: "mode.set"; mode: WorldMode }
  | { cmd: "haunt.approve"; hauntId: Id }
  | { cmd: "haunt.reject"; hauntId: Id }
  | { cmd: "haunt.releaseSeeded"; count: number }
  | { cmd: "haunt.dareDone"; hauntId: Id }        // webcam mode
  | { cmd: "finals.approvalMode"; on: boolean }
  | { cmd: "policy.pin"; version: string }
  | { cmd: "coach.run" };
```

Handlers:
- **world:** `round.*`, `replay.start`, `mode.set`, `haunt.dareDone`
- **crowd:** `haunt.*` (except `dareDone`), `finals.approvalMode`
- **brain:** `policy.pin`, `coach.run`

## 5. C16: Episode artifacts

```
data/
  bus.jsonl                         # every envelope (hub)
  episodes/<episodeId>/
    episode.json                    # Episode                (world)
    ended.json                      # EpisodeEnded           (world)
    events.jsonl                    # envelopes for episode  (hub)
    video.webm                      # stage recording        (world, may be absent)
    frames/<seq>.jpg                # tick frames            (brain)
    verdict.json                    # final Verdict          (crowd)
  seeds/<sha>.jpg                   # seed images ≤ 48 KB    (world)
  replay/frames.jsonl               # ReplayFrame            (brain)
  policies/<version>.yaml           # promoted policies      (brain)
  evals.jsonl                       # ReplayEvalResult log   (brain)
  proof.json                        # pitch numbers          (crowd)
```

`GET /data/<path>` serves these read-only and requires the operator token (header `x-pg-token`).

## 6. C17: HTTP endpoints

| Method and path | Owner | Request → Response | Callers |
|---|---|---|---|
| `POST /api/world/session` | world | internal `SessionRequest` → `SessionGrant` | `/stage` only (world-internal) |
| `POST /api/world/session/:id/end` | world | `{ reason }` → `{ ok }` (idempotent) | `/stage`, watchdog |
| `POST /api/world/seed-image` | world | JPEG/PNG body → `{ imagePath, bytes }` (re-encoded to ≤ 48 KB) | `/operator` |
| `POST /api/world/episode/:id/video?part=n` | world | webm chunk → `{ ok }` | `/stage` |
| `GET /api/world/ledger` | world | → `CostLedger` | `/operator` |
| `POST /api/brain/tick` | brain | `TickRequest` → `TickResponse` | `/stage`, fake world |
| `GET /api/brain/policy` | brain | → `{ version, yaml }` | `/operator`, coach |
| `POST /api/brain/replay-eval` | brain | `ReplayEvalRequest` → `ReplayEvalResult` | `/operator`, MCP, `pnpm proof` |
| `GET /api/brain/coach/status` | brain | → `{ running, lastRun?, proposals[] }` | `/operator` |
| `POST /mcp` | brain | MCP Streamable HTTP, `Authorization: Bearer PG_MCP_TOKEN` | the Managed Agent coach |
| `POST /api/crowd/haunt` | crowd | `{ text?, preset?, revisionOf? }` + `pg_device` cookie → `{ hauntId, status }` | phones |
| `GET /api/crowd/presets` | crowd | → `{ id, label, text, tags }[]` | phones |
| `GET /api/crowd/state` | crowd | → `{ episodeActive, round?, nextRoundAt?, mine: HauntReceipt[], queue: HauntPublic[] }` | phones (poll every 2 s) |
| `GET /api/crowd/scoreboard` | crowd | → `Scoreboard` | `/stage`, `/operator` |
| `GET /api/crowd/queue` | crowd | → `Haunt[]` (includes raw; operator token) | `/operator` |
| `GET /api/bus/history` | hub | `?episodeId&types&since` → `Envelope[]` | referee, tests |

For crowd state, derive `mine` from the caller’s device cookie. Return `queue` in dispatch order, containing only eligible, approved proposals with display-safe text and nicknames. Raw text, unreviewed nicknames and moderation reasons stay off shared views. A successful `haunt.injected` acknowledges delivery to Genie; visual confirmation comes from the world frames.

Every error response has the form `{ error: { code: string, message: string } }`. Codes used across lanes: `BUSY`, `CAP_USD`, `GENIE_UNAVAILABLE`, `RATE_LIMITED`, `REJECTED`, `INVALID`, `UNAUTHORIZED`.

## 7. C18: Hub integration interface (`hub-types.ts`, world)

```ts
import type { FastifyInstance } from "fastify";
export interface HubContext {
  bus: Bus;
  dataDir: string;
  env: Record<string, string | undefined>;
  instance: Instance;
  log: (lane: Lane, msg: string, extra?: object) => void;
}
export interface LaneModule {
  lane: Lane;
  kind: "real" | "fake";
  register(app: FastifyInstance, ctx: HubContext): Promise<void>;   // mount /api/<lane>/*, pages, /mcp (brain)
  health(): Promise<{ ok: boolean; detail?: string }>;
  close?(): Promise<void>;                                           // world: MUST end any Genie session
}
export interface Bus {
  publish<T extends EventType>(type: T, source: Source, payload: PayloadOf<T>, episodeId?: Id): Envelope<T>;  // validates, throws on invalid
  subscribe(types: EventType[] | "*", handler: (e: Envelope) => void): () => void;
  history(filter: { episodeId?: Id; types?: EventType[]; since?: EpochMs }): Envelope[];
}
```

Each lane exports a default `LaneModule` from both `apps/<lane>/server/index.ts` (real) and `apps/<lane>/server/fake.ts` (fake). The hub picks one using `PG_<LANE>=real|fake`, and the default is `fake`.

## 8. Fixtures, fakes and tests

### Fixture layout

```
fixtures/<contract-kebab>/valid/<scenario>.json      # must validate
fixtures/<contract-kebab>/invalid/<case>.json        # must FAIL validation (≥ 2 per contract)
fixtures/scenarios/<name>/                           # cross-lane bundles (owner: brain)
    episode.json  ended.json  ticks.jsonl  injected.jsonl  haunts.jsonl  README.md
fixtures/media/fixture-zero/                         # ~20 phone photos 640×360 + labels.json (owner: brain)
fixtures/media/ep_real_NNN/                          # exported real episodes (owner: world, via `pnpm fixtures:export`)
```

### Required v1 fixtures (owner in brackets; due H+0:30)

| Contract | Valid scenarios |
|---|---|
| Episode / EpisodeEnded [world] | `genie-text-seed`, `genie-image-seed`, `replay`, `human-driver` / `success`, `timeout`, `watchdog` |
| TickRequest [world] | `first-tick`, `mid-episode`, `with-recent-haunt`, `human-driver` |
| TickResponse [brain] | `track`, `search`, `unstick`, `success`, `fallback-timeout` |
| TickLog [brain] | `track`, `lost` |
| Haunt / HauntPublic / HauntDispatch [crowd] | `submitted`, `rejected-unsafe`, `approved-fog`, `injected`; `presets.json`; `seeded-pool.json` (12 pre-approved) |
| HauntInjected [world] | `ok`, `failed`, `simulated` |
| Verdict [crowd] | `provisional-adversary`, `final-world-override`, `success`, `aborted` |
| Scoreboard [crowd] | `empty`, `midday` |
| PolicyPromoted / Replay* [brain] | `coach-promotion` / `frame-labeled`, `eval-heldout` |
| CostLedger [world] | `fresh`, `near-cap` |
| OperatorCommand [crowd] | one per `cmd` |

**Scenario bundles** [brain, due H+0:45]. The crowd referee's tests depend on these:
- `clean-success`
- `lost-after-haunt` (expect adversary)
- `world-forgot` (expect world)
- `agent-wander` (expect agent)
- `haunt-but-irrelevant` (an audio-only tag near the failure; expect agent)
- `never-seen` (expect agent, `failureT` 0)

They start synthetic. After H+1:30, brain adds real versions cut from `ep_real_*`.

### Fakes (each lane ships `server/fake.ts` by H+0:45)

- **Fake world.** On `operator.command round.start`, or on `POST /api/world/fake/run?scenario=<name>&speed=<n>`:
  - Publishes `episode.started`.
  - Replays frames from `fixtures/media/fixture-zero` (or a scenario's frames) at 2 Hz × `speed` (default 4), calling **`POST /api/brain/tick` over real HTTP**.
  - Answers each `haunt.dispatch` with `haunt.injected { ok: true, simulated: true }`.
  - Ends with `success_claim` after two consecutive `successClaim`s, otherwise `timeout`.
  - Writes `episode.json` and `ended.json`.
- **Fake brain.** `POST /api/brain/tick` returns `fixtures/tick-response/valid/*` cycled by `seq`, with `successClaim` at `seq ≥ 20`. It also writes frames and publishes `tick`.
- **Fake crowd.** On `episode.started`, dispatches from `seeded-pool.json` at t ≥ 8 s and then every 12 s. On `episode.ended`, publishes `verdict.provisional` using the real rule if available, otherwise a constant agent verdict. It also publishes `scoreboard.updated`.

### Adapter seams (so pair tests are free)

| Lane | Real adapter | Free test adapter |
|---|---|---|
| world | `GenieAdapter` (server) and `GenieClient` (browser) | `FakeGenieAdapter`, which asserts `end()` is called on every path |
| brain | `PerceptionAdapter` (`er2` \| `hydrogen` \| `neon`) | `fixture`, which reads `labels.json` |
| brain | `CoachAdapter` | `scripted` |
| crowd | `ModerationAdapter` (`hydrogen`) | `rules-only` |
| crowd | `JudgeAdapter` (`neon`) | `rule` |

### Test pyramid (commands are defined by world in the root `package.json`)

1. **`pnpm test:contracts`:**
   - Every `valid/` fixture parses; every `invalid/` fixture fails.
   - Every event type in the registry has at least one valid fixture.
   - Every scenario bundle validates line by line.
2. **`pnpm test`:** lane unit, producer and consumer tests, as vitest projects (`pnpm test --project brain`).
   - **Producer test:** feed fixture inputs and assert the outputs parse against the schema.
   - **Consumer test:** load the *producer's* fixtures and assert correct handling.
3. **`pnpm e2e:pair --real=<lane>`:** your lane real, the other two fake, every paid adapter on its free version. **Required before pushing server changes.**
4. **`pnpm e2e:fake`:** all fakes, run in-process. It asserts this order: `episode.started` → ≥10 `tick` → ≥1 `haunt.injected` → `episode.ended` → `verdict.provisional` (within 2 s) → `scoreboard.updated`. Every envelope must validate.
5. **`pnpm check`:** typecheck + lint + 1 + 2 + 4. Target under 90 s. Required before every push.
6. **`@live` tests:** real APIs, with `PG_LIVE=1`, run by humans only.

## 9. Change protocol

| Change | Allowed when | Steps |
|---|---|---|
| **Minor:** a new optional field, a new event type, a new enum value | until H+6:00 | The producer edits the schema and fixtures, bumps `VERSION` (1.x), posts a `NOTICE` listing affected consumers, and keeps `pnpm check` green. Consumers `ACK` once their tests pass. A new enum value counts as minor, but consumers must handle unknown values gracefully. |
| **Major:** remove or rename a field, make a field required, change meaning | until H+3:00, at a huddle | The producer posts `CONTRACT-CHANGE` with the diff and the reason. Consumers `ACK`, and both humans agree. The producer lands **one** commit tagged `[contract-migration]` that updates the schema, fixtures **and every consumer call site**. This is the only allowed cross-ownership edit, and the hook allows it via that tag. |
| Any change | after H+6:00 | Not allowed. |

The canonical version of each contract is the `VERSION` in its file. Each lane records the versions it implements in `comms/status/<lane>.json`.
