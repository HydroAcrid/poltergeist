# BRAIN TODO (work top-down; tick items as you finish)

## Setup: by H+0:30 (write locally right away; push once world's scaffold is on `main`)
- [ ] `tick-response.ts`, `tick-log.ts`, `policy.ts`, `replay.ts` + valid/invalid fixtures (CONTRACTS §8)
- [ ] `fixtures/media/fixture-zero/`: your human hands you ~20 hallway photos; resize to 640×360; hand-label `labels.json` `{file, visible, point}`
- [ ] Rebase on scaffold → `pnpm test:contracts` green → push → NOTICE all

## Fakes and scenarios: by H+0:45
- [ ] `apps/brain/server/fake.ts` (fake brain, CONTRACTS §8)
- [ ] Six scenario bundles in `fixtures/scenarios/` (synthetic) → FIXTURE-READY → crowd

## Tier 0: H+1:30
- [ ] Controller as a pure function + unit tests on every scenario (track, search, unstick, success, fallback, human driver)
- [ ] Real `POST /api/brain/tick` with `PerceptionAdapter=fixture`; `pnpm e2e:pair --real=brain` green
- [ ] `er2` adapter + `@live` probe on `fixture-zero` (accuracy + p50/p95 latency → EVALS.md; your human runs it)
- [ ] Frames written + `tick` published after the response

## Tier 1: H+2:30
- [ ] `/brain/debug`: last 20 ticks (frame thumbnail, perception, action, latency, mode)
- [ ] Live calibration with your human: degrees per 100 ms ArrowRight → `kYaw`, `searchStepMs`; distance per W hold → `kFwd`; save as `v1` values
- [ ] Alternative adapters `hydrogen` / `neon` behind env; compare on `fixture-zero` + `ep_real_001`
- [ ] Real scenario bundles cut from `ep_real_*` → FIXTURE-READY → crowd

## Tier 2: H+4:30
- [ ] Replay set builder (audit-model labels, tags, split by episode, clean flag)
- [ ] `/brain/label` spot-check page (your human labels 50 frames)
- [ ] `replay-eval` CLI + endpoint; first results in EVALS.md (v1 on train / heldout / clean)

## Tier 3: H+6:00
- [ ] `/mcp` with the four tools + bearer auth; gate implemented server-side with tests
- [ ] `CoachAdapter=scripted` end-to-end through MCP (no paid calls) in a test
- [ ] `CoachAdapter=managed`: first real background run (your human triggers `coach.run`), budget cap set
- [ ] Hot-reload a promoted policy + `policy.promoted` → crowd shows it

## Stretch
- [ ] Pipelined inference: send the next perception call when the current hold is 70% done
- [ ] Perception ensemble (ER 2 + Neon) only when they disagree, if latency allows
