# CROWD TODO (work top-down; tick items as you finish)

## Setup: by H+0:30 (write locally right away; push once world's scaffold is on `main`)
- [ ] `haunt.ts`, `verdict.ts`, `scoreboard.ts`, `operator.ts` + valid/invalid fixtures (CONTRACTS §8)
- [ ] `presets.json` (8–10 world events with tags), `seeded-pool.json` (12 pre-approved), `moderation-cases.json` (30, ≥ 10 adversarial with placeholder tokens)
- [ ] Rebase on scaffold → `pnpm test:contracts` green → push → NOTICE all

## Fakes: by H+0:45
- [ ] `apps/crowd/server/fake.ts` (fake crowd, CONTRACTS §8)
- [ ] FIXTURE-REQUEST → brain for any scenario bundle you need beyond the six listed

## Tier 0: H+1:30
- [ ] `POST /api/crowd/haunt` + cookie + rate limits + `rules-only` moderation; `GET /presets`, `GET /state`
- [ ] Queue + scheduler driven by `episode.started` / `ended` and `haunt.injected`
- [ ] `/haunt` phone page v1 (text, chips, nickname, my hauntings, countdown)
- [ ] `hydrogen` moderation adapter + `@live` accuracy test on `moderation-cases.json` (your human runs it)

## Tier 1: H+2:30
- [ ] Referee rule + `verdict.provisional` in < 1 s; tests for every scenario bundle (`world-forgot` must return `world`)
- [ ] Scoreboard + kill feed + `scoreboard.updated`
- [ ] `/overlay` (kill feed, scoreboard, timer, QR)
- [ ] `/operator` v1: start/stop round, queue approve/reject, release seeded, ledger, lane health

## Tier 2: H+4:30
- [ ] `JudgeAdapter=neon` with ffmpeg clips → `verdict.final` (20 s timeout → rule)
- [ ] Finals approval mode; nickname moderation; webcam dare buttons; mode switch
- [ ] `pnpm proof` → `data/proof.json`
- [ ] Recruitment support: printable QR page `/haunt/qr` with the round schedule

## Tier 3: H+6:00
- [ ] Audit-model dispute review for verdicts with `confidence < 0.5` (background; updates `verdict.final` only if it changes)
- [ ] Policy version + held-out hit rate on the overlay when `policy.promoted` arrives
- [ ] Final `proof.json` snapshot → hand to the demo/pitch person

## Stretch
- [ ] Cluster near-duplicate hauntings (embedding similarity) so the queue stays varied
- [ ] "Top attacker" moment on the overlay at the end of each round
