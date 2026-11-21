# Lane: CROWD

**Mission:** turn a room of strangers into attackers, keep it safe, and keep score honestly. That means the phone page, moderation, the haunting scheduler, the referee, the scoreboard, the operator console and the overlay.

## Owns
`apps/crowd/**` (server, the `/haunt`, `/operator` and `/overlay` pages, `scripts` for `pnpm proof`), and the contract files `haunt`, `verdict`, `scoreboard` and `operator` together with their fixtures (including `presets.json`, `seeded-pool.json` and `moderation-cases.json`).

## Produces
- C07 Haunt / HauntPublic / HauntDispatch
- C09 Verdict
- C10 Scoreboard
- C14 OperatorCommand (via `/operator`)
- `verdict.json`
- `proof.json`

## Consumes
- C03 Episode / EpisodeEnded
- C06 TickLog
- C08 HauntInjected
- C11 PolicyPromoted
- C13 CostLedger
- C15 LaneHealth
- `fixtures/scenarios/*` (from brain)

## Phone page `/haunt` (mobile-first, loads in under 1 s, no login)

- **Text box:** 80 characters max, with a counter.
- **Preset chips:** 6–10, from `presets.json`. Tapping one sends it.
- **Optional nickname:** 16 characters max.
- **"My hauntings" list:** each item shows its status: queued, injected, then 💀 *landed* or 🛡️ *robot survived*.
- **Next-round countdown**, from `GET /api/crowd/state` polled every 2 s.
- **Consent line:** "Approved hauntings may appear on the big screen with your nickname."
- **Device identity:** a `pg_device` cookie (random id).
- **Rate limits:** one submission per 20 s and 30 per day per device; over the limit returns `RATE_LIMITED` with a friendly message.

## Moderation (`ModerationAdapter`: `hydrogen` | `rules-only`)

1. **Pre-filter:** a blocklist and length check. Anything that fails is rejected without calling the model.
2. **Model call** (`PG_MODEL_MODERATION`, JSON only). It returns `{ safe, text, tags, reason }`:
   - `text` is rewritten as a **physical, environmental event in the scene**, in the present tense, 60 characters or fewer.
   - **Example:** "fog lol" becomes "Thick fog rolls down the hallway".
3. **Reject:**
   - real people, names or anything aimed at attendees
   - violence or gore, weapons
   - sexual content, hate or slurs, self-harm
   - brands or logos
   - text or instructions meant to appear as words in the world
   - anything that isn't a world event
4. **Tags** are chosen from `HauntTag` and must be 1–3 of them.
5. **`moderation-cases.json`:** 30 cases, at least 10 of them adversarial. Use placeholder tokens such as `<SLUR>` and `<CELEB_NAME>`; never write real slurs. Each case has an expected safe/unsafe value and expected tags. Write a `@live` test so your human can measure accuracy.
6. Every change of status publishes `haunt.public` (never `raw`).

## Queue and scheduler

- **Score:** `votes + 2·diversity + 0.5·freshness`.
  - `diversity` is 1 if the haunting's main tag isn't among the last 2 dispatched.
  - `freshness` decays over 3 minutes.
- **During an active episode** (`episode.started` with no `episode.ended` yet):
  - The first dispatch happens at `t ≥ 8000`.
  - Then one every `PG_HAUNT_INTERVAL_MS` (default 12000), up to `PG_HAUNT_MAX_PER_EPISODE` (default 6).
- **Finals approval mode:** only operator-approved hauntings are dispatched.
- **Empty queue:** if fewer than 2 are queued when a slot comes up and `seededFallback` is on, use the seeded pool.
- **Failed injection:** when `haunt.injected { ok: false }` arrives, set the haunting's status to `failed` and don't retry it.

## Referee: rule first (fast, deterministic), then the model

On `episode.ended`, read the ticks and hauntings from the bus history (or `events.jsonl`) and compute the following.

**1. Outcome**
- `success` if `reason === "success_claim"`.
- `aborted` if the reason is `operator_stop`, `error` or `watchdog` **and** `durationMs < 10000`.
- Otherwise `failure`.

**2. `failureT`**
- `L` is the final run of consecutive ticks, ending at the last tick, where `!visible || mode ∈ {search, unstick}`.
- If the target was never visible, `failureT = 0`.
- If `L` is empty (the player saw the target right up to the end), `failureT` is the last tick's `t`.
- Otherwise `failureT` is the `t` of the first tick in `L`.

**3. Rule blame** (first match wins)

- **a. adversary:** some injected haunting `h` (`ok`) has `h.t ∈ [failureT − 8000, failureT + 1000]`, and its tags include at least one of `visibility`, `lighting`, `occlusion`, `geometry`, `distractor`, `sign_change` or `weather`. The culprit is the latest such haunting.
- **b. world:** all of the following are true:
  - `L` exists.
  - The tick just before `L` has `visible && conf ≥ 0.7`.
  - That tick's `action` was small: `NOOP`, a turn with `holdMs ≤ 150`, or `W`/`S` with `holdMs ≤ 400`.
- **c. agent:** everything else, including the never-visible and "tracked but slow" cases.

**4.** Publish `verdict.provisional` **within 1 s** with `model: "rule"`. Confidence is 0.6 for adversary, 0.5 for world or agent, and 0.8 for success.

**5. `JudgeAdapter` (`neon` | `rule`)**
- **Clip:** cut an mp4 of `failureT − 6 s … +3 s` from `video.webm` with ffmpeg. For a success, use the whole episode up to 30 s.
- **Model input:** the clip, the rule verdict, a compact tick table (`t`, `visible`, `conf`, `action`, `mode`) and the injected hauntings with their `t` and `text`.
- **Overruling:** the model may overrule the rule **only with visible evidence**, citing timestamps.
- **Output:** publish `verdict.final` within 20 s. On timeout, the final verdict is the provisional one with `model: "rule"`.
- **Save** `verdict.json`.

**Tests:** one test per scenario bundle, with expected values in `apps/crowd/test/expected/<scenario>.json`. The `world-forgot` scenario **must** come out as `world`. If a scenario is missing, send a `FIXTURE-REQUEST` to brain.

## Scoreboard and kill feed

- **What counts as "landed":** the verdict (final, or provisional until a final exists) has `blame === "adversary"` and the haunting is the culprit.
- **Recompute** on every verdict, injected haunting or promoted policy, then publish `scoreboard.updated`.
- **Kill feed entries** must be display-safe:
  - `💀 {nickname|"anon"}: {moderated.text} → robot lost the target`
  - `🛡️ … → robot shrugged it off`
  - `👻 world glitch: Genie forgot the target`

## `/overlay` (transparent iframe over `/stage`)

- kill feed (bottom left)
- mini scoreboard (top right)
- round timer
- a QR code to `/haunt`, large at the start of each round, then shrinking to a corner
- the current policy version
- the finals-mode styling switch

## `/operator` (operator token required)

Controls:
- **Start round:**
  - a seed text prompt, or a photo upload via `POST /api/world/seed-image`
  - the task fields
  - the driver
  - the max duration
- **Stop round, start replay**
- **Queue view** with raw text, plus approve/reject
- **Release N seeded hauntings**
- **Finals approval mode** toggle
- **Mode switch** (genie, webcam, replay)
- **Webcam dares:** "dare done" buttons
- **Policy:** pin, and run the coach

Displays:
- the cost ledger
- lane health
- the last 10 verdicts, with links to their clips

## `pnpm proof` → `data/proof.json`

The numbers in SPEC §11. Pull the replay numbers from `POST /api/brain/replay-eval` and the latency from brain's status or ticks.

## Gotchas

- Phones are on bad venue Wi-Fi, so keep `/haunt` tiny: no large libraries, and inline the CSS.
- Never trust the client. Validate everything, and derive `deviceId` from the cookie only.
- The rule is the contract; the model only explains it. If the model overrules the rule more than 30% of the time, tell your human, because something is off.
