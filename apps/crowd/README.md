# Crowd lane

Phone page `/haunt`, moderation, the FIFO haunting queue and scheduler (plus the referee, scoreboard, `/overlay` and `/operator` later). See `CLAUDE.md` and `TODO.md`.

## Run it locally (until World's hub is on main)

```sh
cd apps/crowd
pnpm install --ignore-workspace --allow-build esbuild
pnpm check     # typecheck + tests
pnpm dev       # http://localhost:8788/haunt, controls at /dev
```

`pnpm dev` runs a local stand-in hub with an in-memory bus and a stand-in World that answers each `haunt.dispatch` with `haunt.injected { ok: true, simulated: true }`. Phones on the same Wi-Fi can open the LAN address it prints.

## Temporary shims

`test/shims/contracts/{common,episode,haunt-injected,hub-types}.ts` stand in for World-owned contract files that aren't on main yet (same approach as `apps/brain`). Delete them once World's scaffold lands. `dev/` (memory bus, stand-in World, dev hub) goes too once the real hub and fake World exist.
