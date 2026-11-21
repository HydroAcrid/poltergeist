# WORLD TODO (work top-down; tick items as you finish)

## Setup: push by H+0:20 (the other lanes are blocked until this lands)
- [ ] Workspace scaffold, tsconfig, vitest projects, lint
- [ ] `packages/contracts`: `common`, `envelope`, `registry`, `hub-types`, `index` + `test/fixtures.test.ts`
- [ ] Hub: bus (validate, broadcast, history), recorder, `/bus` WebSocket with tokens, `/api/bus/history`, `/data`, LaneModule loader with no-op fallback, health polling
- [ ] Scripts: `check-ownership`, `inbox`, `msg`, `status`, `proof` stub; git hooks; root scripts; CI workflow; Dockerfile
- [ ] Push, then `pnpm msg NOTICE all "scaffold on main, pull now"`

## Contracts: by H+0:30
- [ ] `episode.ts`, `tick-request.ts`, `haunt-injected.ts`, `cost.ts` + valid/invalid fixtures (CONTRACTS §8)
- [ ] `pnpm test:contracts` green with all three lanes' files → tell your human to tag `contracts-v1`

## Fakes and harness: by H+1:00
- [ ] `apps/world/server/fake.ts` (fake world, CONTRACTS §8)
- [ ] `e2e/fake.test.ts` (`pnpm e2e:fake`) and the `--real=<lane>` pair runner
- [ ] Deploy staging (`main`) and prod (`demo` branch); confirm `/stage` loads on both

## Tier 0: H+1:30
- [ ] `GenieAdapter` (real + fake) and broker with caps, ledger, watchdog, heartbeat; tests for every end path
- [ ] `@live` probe test: create → setup → hold W 1 s → text "dense fog fills the hallway" → end; logs timings (your human runs it)
- [ ] `/stage`: connect, render, manual drive (`M`), 2 Hz tick loop with flow control, apply actions
- [ ] Episode lifecycle events + artifacts; `cost.updated`
- [ ] First real round (with humans) → `pnpm fixtures:export` → `ep_real_001` → NOTICE all

## Tier 1: H+2:30
- [ ] `haunt.dispatch` → `GenieClient.text` → `haunt.injected`
- [ ] Thought bubble overlay and `/overlay` iframe slot
- [ ] Recorder upload → `video.webm`
- [ ] Success/timeout end paths verified live

## Tier 2: H+4:30
- [ ] Seed photo pipeline (`/api/world/seed-image`, ≤ 48 KB)
- [ ] Replay mode (`R`) with REPLAY badge
- [ ] Webcam mode + dares
- [ ] Operator command handlers (`round.*`, `replay.start`, `mode.set`, `haunt.dareDone`)
- [ ] Resilience: bus auto-reconnect, `/stage` recovers from a dropped bus without killing the episode

## Tier 3 / freeze: H+6:00
- [ ] Failure drills: `R` swaps to replay in < 3 s; `K` kills and closes cleanly; verify on prod
- [ ] Finals layout (`F`): bigger thought bubble, HUD hidden, QR large at start
- [ ] Hardening pass: run 3 back-to-back rounds on prod with no leaked sessions (ledger `sessionsActive` returns to 0)

## Stretch (only if nothing above is open and no lane has a BLOCKER)
- [ ] Latency HUD (frame→action ms) for the Agora/real-time judges
- [ ] Two-up view: live world plus the last failure clip
