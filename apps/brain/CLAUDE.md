# Lane: BRAIN

**Mission:** the player's eyes and hands, then the evidence that it improves: perception, controller, replay eval, the MCP tools and the Managed Agent coach behind a CI gate.

## Owns
`apps/brain/**` (server, CLI, `policies/`, `/brain/debug`, `/brain/label`, `EVALS.md`), the contract files `tick-response`, `tick-log`, `policy` and `replay` together with their fixtures, `fixtures/scenarios/**` and `fixtures/media/fixture-zero/**`.

## Produces
- C05 TickResponse
- C06 TickLog
- C11 PolicyPromoted
- C12 Replay*
- the scenario bundles
- frames in `data/episodes/<id>/frames/`

## Consumes
- C03 Episode / EpisodeEnded
- C04 TickRequest
- C08 HauntInjected
- C09 Verdict (to find failures)
- C14 OperatorCommand (`policy.pin`, `coach.run`)

## `POST /api/brain/tick`

Per-episode state lives in memory, keyed by `episodeId`. The handler:
1. Validates the request.
2. Calls `PerceptionAdapter.perceive(frame, task, policy)` with `timeoutMs`.
3. Runs the controller.
4. Responds.
5. *After* responding, writes the frame to `frames/<seq>.jpg` and publishes `tick`.

The total must stay under 3000 ms. On a perception error or timeout, return `mode: "fallback"`.

### PerceptionAdapter: `er2` (default) | `hydrogen` | `neon` | `fixture`

Base prompt. Policy `promptAddenda` are appended. **Verify ER 2's real output format with a `@live` probe on `fixture-zero`.**

```
You are the eyes of a robot in a first-person 3D world. Target: {targetLabel}.
Return ONLY JSON: {"visible": boolean, "point": [y, x], "box": [ymin, xmin, ymax, xmax],
"conf": number, "hazards": [{"label": string, "point": [y, x]}]}.
Coordinates are integers normalized to 0-1000, origin top-left.
If the target is not clearly visible, set visible=false and omit point and box.
List at most 3 hazards that block the path to the target.
```

- Parse defensively: strip code fences and clamp values to range.
- If parsing fails and at least 800 ms of budget remains, retry once.
- Record `latencyMs` on every call.
- The `fixture` adapter reads `fixtures/media/fixture-zero/labels.json` (and scenario labels) and makes no API calls. Pair tests use it.

### Controller: a pure function `(state, perception, req, policy) → { state, action, mode, rationale, successClaim }`

Unit-test it heavily against `fixtures/scenarios/*`.

- **Smoothing:**
  - `emaPoint = α·point + (1−α)·emaPoint`.
  - Reject jumps over `maxPointJump` unless `conf ≥ 0.8`.
  - `e = (emaX − 500) / 500` and `boxH = (ymax − ymin) / 1000`.
- **Track** (target visible):
  - If `|e| > yawDeadband`, turn toward it: `ArrowRight` (if `e > 0`) or `ArrowLeft`, held for `clamp(kYaw·|e|, 120, 600)`.
  - Otherwise go forward: `W` for `clamp(kFwd·(1 − boxH), 300, 1200)`, or `defaultFwdMs` if there's no box.
- **Search:**
  - Add 1 to `lost` each tick the target isn't visible. At `lost ≥ lostTicksBeforeSearch`, hold `ArrowRight` for `searchStepMs` (about 45°).
  - After `searchMaxSteps` steps, hold `W` for `exploreFwdMs` and reset the count.
- **Unstick:** if `executing.key === "W"` and `frameDiff < stuckDiffThreshold` for `stuckTicks` ticks, hold `S` for 400 ms, then `ArrowLeft` for 300 ms (over two ticks).
- **Success:** if `boxH ≥ successBoxHeight` and `|e| < successCenter` for `successTicks` consecutive ticks, set `successClaim: true` and return `NOOP`.
- **Fallback:** if the last action was `track` and is less than 1500 ms old, repeat it at half the hold. Otherwise `NOOP`.
- **Human driver:** when `driver === "human"`, still perceive and compute an action (world ignores it), and never claim success.
- **Rationale:** 60 characters or fewer, e.g. "door 2 o'clock → turning", "lost target, scanning", "stuck, backing up".

### `policies/v1.yaml` (internal to brain; promoted versions go in `data/policies/`)

```yaml
version: v1
parent: null
createdBy: human
rationale: baseline
perception: { adapter: er2, thinking: low, timeoutMs: 2500, promptAddenda: [] }
controller:
  emaAlpha: 0.5
  maxPointJump: 300
  yawDeadband: 0.15
  kYaw: 600            # ms of turn per unit |e|   (calibrate: degrees per 100 ms ArrowRight)
  kFwd: 1200           # ms forward per unit (1 - boxH)
  defaultFwdMs: 600
  lostTicksBeforeSearch: 2
  searchStepMs: 450    # ≈ 45° (calibrate live)
  searchMaxSteps: 8
  exploreFwdMs: 800
  stuckDiffThreshold: 0.02
  stuckTicks: 2
  successBoxHeight: 0.45
  successCenter: 0.2
  successTicks: 2
```

## Scenario bundles (`fixtures/scenarios/`, due H+0:45; the crowd referee depends on them)

Ship `clean-success`, `lost-after-haunt`, `world-forgot`, `agent-wander`, `haunt-but-irrelevant` and `never-seen`, as described in CONTRACTS §8.
- Each bundle includes synthetic `episode.json`, `ended.json`, `injected.jsonl` and `haunts.jsonl` that validate against the world and crowd schemas.
- Each bundle has a `README.md` saying the expected blame **in words**. Crowd writes its own expected-verdict tests.
- `framePath` may point to `fixture-zero` images.
- After H+1:30, add `real-*` bundles cut from `ep_real_*`.

## Replay eval (Tier 2)

- **Builder** (`pnpm --filter brain replay:build`):
  - Turns every finished episode into frames at 2 Hz in `data/replay/frames.jsonl`.
  - Labels come from `PG_MODEL_AUDIT` at high thinking: `{visible, point}` for the target.
  - `tags` come from the hauntings injected in the previous 10 s.
  - `split = hash(episodeId) % 5 === 0 ? "heldout" : "train"`.
  - `clean` means no haunting in the previous 10 s.
- **`/brain/label`:** shows the frame plus the audit model's point. Keys: `Y` (correct), `N` (wrong), click to correct. A human checks 50 frames, and those become `labelSource: "human"`.
- **`replay-eval`** (CLI + `POST /api/brain/replay-eval`):
  - Runs a policy's perception on a split, using the hit definition in CONTRACTS C12.
  - Appends results to `data/evals.jsonl` and `EVALS.md`.
  - **Never tune on `heldout`.**

## Coach (Tier 3): the Managed Agents prize

- **The `/mcp` server** (Streamable HTTP, bearer `PG_MCP_TOKEN`) exposes four tools:
  - `list_failures({ limit = 20, blame? })` → `[{ episodeId, verdict, clipUrl, policyVersion }]`. Clips are cut with ffmpeg: `failureT − 6 s … +3 s`.
  - `get_episode({ episodeId })` → `{ episode, verdict, ticks: compact[], haunts }`
  - `run_replay_eval({ policyYaml, split })` → `ReplayEvalResult`
  - `propose_policy({ policyYaml, rationale })` → `{ promoted, version?, results, reason }`. **The gate runs server-side. Never trust the agent's own claims.**
- **Gate:** promote only if all three hold:
  - `heldout.hitRate ≥ parent.heldout.hitRate + 0.05`
  - `clean.hitRate ≥ parent.clean.hitRate − 0.02`
  - `heldout.n ≥ 40`
  - On promotion: write `data/policies/<v>.yaml`, hot-reload it in the tick handler, and publish `policy.promoted`.
- **`CoachAdapter` (`managed` | `scripted`):**
  - Triggered by `operator.command coach.run`.
  - Starts a **background** Managed Agent interaction (`PG_MANAGED_AGENT`) with tools: remote MCP (our `/mcp`) and code execution.
  - Set a budget cap. If environment hooks are available, block every network destination except our MCP host.
  - The agent's instructions: study failures where blame is `agent` or `adversary`, form a hypothesis, then call `run_replay_eval` on `heldout` and `clean` **before** `propose_policy`. At most 3 proposals per run.
  - Poll for status, expose it on `GET /api/brain/coach/status` and log every tool call.
  - At most one run every 20 minutes.
  - **VERIFY the Interactions API and Managed Agents request shapes at kickoff.** The `scripted` adapter must exercise the same MCP path.

## Gotchas

- Perception latency sets the loop rate, so measure p50 and p95 on the first real round and post them in your status. If p95 is over 2.5 s, compare `hydrogen` and `neon` at low thinking (`PG_MODEL_PERCEPTION`).
- Genie may forget objects after the camera turns away. That isn't your bug: blame `world` is a valid outcome. Don't "fix" it with controller hacks that hide it.
