// Pregame waiting room (World assigned to Crowd on #2): count real guest phones only, never the
// projector; the phone follows World's lobby phase instead of an invented countdown.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrowdState } from "@poltergeist/contracts/haunt.js";
import type { MatchClock } from "../server/crowd.js";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
beforeEach(async () => {
  hub = await buildTestHub();
});
afterEach(async () => {
  await hub.close();
});

async function guest(asPhone = true) {
  const first = await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: asPhone ? { "x-pg-client": "phone" } : {} });
  const cookie = String(first.headers["set-cookie"]).split(";")[0]!;
  const poll = async () =>
    CrowdState.parse((await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: { cookie, ...(asPhone ? { "x-pg-client": "phone" } : {}) } })).json());
  return { cookie, poll };
}
const lobby = async () => (await hub.app.inject({ method: "GET", url: "/api/crowd/lobby" })).json();

describe("joined count", () => {
  it("counts each guest phone once, however often it polls", async () => {
    const a = await guest();
    const b = await guest();
    await a.poll();
    await a.poll();
    await b.poll();
    expect(await lobby()).toEqual({ here: 2, total: 2 });
    expect((await a.poll()).joined).toBe(2);
  });

  it("never counts the projector or other non-phone polls", async () => {
    await guest();
    const projector = await guest(false);
    await projector.poll();
    await hub.app.inject({ method: "GET", url: "/api/crowd/lobby" });
    expect(await lobby()).toEqual({ here: 1, total: 1 });
  });

  it("'here' drops phones that stopped polling for 30 s; 'total' remembers everyone who joined", async () => {
    const a = await guest();
    await guest();
    hub.clock.advance(31_000);
    await a.poll();
    expect(await lobby()).toEqual({ here: 1, total: 2 });
  });

  it("a guest who joins late is counted right away and can send an idea", async () => {
    hub.world.startEpisode();
    const late = await guest();
    expect((await late.poll()).joined).toBe(1);
    const res = await hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie: late.cookie }, payload: { preset: "fog" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("phone page follows World's phase", () => {
  it("sends World’s phase in the same paged response as the queue, including phase changes on otherwise identical polls", async () => {
    await hub.close();
    let phase: CrowdState["lobbyPhase"] = "before-photo";
    hub = await buildTestHub({ config: { roundEveryMs: null }, lobbyPhase: () => phase });
    const a = await guest();
    const args = { method: "GET" as const, url: "/api/crowd/state?waitingPage=0", headers: { cookie: a.cookie, "x-pg-client": "phone" } };
    const initial = await hub.app.inject(args);
    expect(initial.json()).toMatchObject({ lobbyPhase: "before-photo", joined: 1 });
    expect(initial.json()).not.toHaveProperty("nextRoundAt");
    phase = "lobby";
    const next = await hub.app.inject({ ...args, headers: { ...args.headers, "if-none-match": String(initial.headers.etag) } });
    expect(next.statusCode).toBe(200);
    expect(next.json()).toMatchObject({ lobbyPhase: "lobby" });
  });

  it("holds the same guest, clock and queued idea across a provider handoff, then dispatches on match time", async () => {
    await hub.close();
    let clock: MatchClock | undefined;
    hub = await buildTestHub({ matchClock: () => clock, config: { seededFallback: false }, lobbyPhase: () => "playing" });
    const a = await guest();
    const me = (await a.poll()).you;
    const durationMs = 600_000;
    const startedAt = hub.clock.now();
    const id = hub.world.startEpisode({ maxDurationMs: Math.min(90_000,durationMs), match:{durationMs,clockMode:"active"} });
    clock = { id, phase: "playing", durationMs, remainingMs: durationMs, deadline: startedAt + durationMs };
    expect(await a.poll()).toMatchObject({ episodeActive: true, roundEndsAt: startedAt + durationMs, slotsPerRound: 50 });

    hub.clock.advance(597_000);
    clock = { ...clock, phase: "handoff", remainingMs: 3_000, deadline: 0 };
    const submitted = await hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie: a.cookie }, payload: { preset: "fog" } });
    expect(submitted.statusCode).toBe(200);
    await hub.crowd.whenIdle();
    hub.clock.advance(30_000); // beyond the initial deadline, including the stale-episode grace
    hub.crowd.tick();
    const paused = await a.poll();
    expect(paused).toMatchObject({ round: 1, episodeActive: true, roundPausedRemainingMs: 3_000, you: me });
    expect(paused.roundEndsAt).toBeUndefined();
    expect(paused.mine[0]?.status).toBe("queued");
    expect(hub.dispatched()).toHaveLength(0);
    expect(hub.crowd.scoreboard().rounds).toBe(0);

    clock = { ...clock, phase: "playing", deadline: hub.clock.now() + 3_000 };
    hub.crowd.tick();
    await hub.world.flush();
    const resumed = await a.poll();
    expect(resumed).toMatchObject({ round: 1, episodeActive: true, roundEndsAt: clock.deadline, you: me });
    expect(resumed.roundPausedRemainingMs).toBeUndefined();
    expect(resumed.mine[0]).toMatchObject({ hauntId: submitted.json().hauntId, status: "injected", episodeId: id });
    expect(hub.crowd.scoreboard().rounds).toBe(0);
    hub.world.endEpisode();
    expect(hub.crowd.scoreboard().rounds).toBe(1);
  });

  it("keeps the five-minute deadline visible on phones through a blackout", async () => {
    await hub.close();
    let clock: MatchClock | undefined;
    hub = await buildTestHub({ matchClock: () => clock, config: { seededFallback: false } });
    const a = await guest();
    const durationMs = 300_000;
    const deadline = hub.clock.now() + durationMs;
    const id = hub.world.startEpisode({ maxDurationMs: 90_000, match:{durationMs,clockMode:"wall",deadline} });
    clock = { id, phase: "handoff", clockMode: "wall", durationMs, remainingMs: 18_000, deadline };
    const first = await a.poll();
    hub.clock.advance(2_000);
    const next = await a.poll();
    expect(next).toMatchObject({ roundEndsAt: deadline, slotsPerRound: 25, you: first.you });
    expect(next.roundPausedRemainingMs).toBeUndefined();
    expect(hub.dispatched()).toHaveLength(0);
  });

  it("uses active play time for dispatch slots throughout a long match", async () => {
    await hub.close();
    let clock: MatchClock | undefined;
    hub = await buildTestHub({ matchClock: () => clock, config: { seededFallback: false } });
    const startedAt = hub.clock.now();
    const id = hub.world.startEpisode({ maxDurationMs: 90_000, match:{durationMs:600_000,clockMode:"active"} });
    clock = { id, phase: "playing", durationMs: 600_000, remainingMs: 600_000, deadline: startedAt + 600_000 };
    for (let i = 0; i < 8; i++) {
      const a = await guest();
      await hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie: a.cookie }, payload: { preset: i % 2 ? "fog" : "banana-peel" } });
    }
    hub.clock.advance(8_000);
    hub.crowd.tick();
    for (let i = 0; i < 5; i++) { hub.clock.advance(12_000); hub.crowd.tick(); }
    expect(hub.dispatched()).toHaveLength(6);
    clock = { ...clock, phase: "handoff", remainingMs: clock.deadline - hub.clock.now(), deadline: 0 };
    hub.clock.advance(100_000);
    hub.crowd.tick();
    clock = { ...clock, phase: "playing", deadline: hub.clock.now() + clock.remainingMs };
    hub.crowd.tick();
    expect(hub.dispatched()).toHaveLength(6);
    hub.clock.advance(12_000);
    hub.crowd.tick();
    expect(hub.dispatched()).toHaveLength(7);
    expect(hub.dispatched().every((d) => (d as { episodeId: string }).episodeId === id)).toBe(true);
  });

  it("marks guest polls and displays the phase supplied by the host", async () => {
    const page = (await hub.app.inject({ method: "GET", url: "/haunt" })).body;
    expect(page).toContain("state.lobbyPhase");
    expect(page).toContain('"x-pg-client": "phone"');
    expect(page).toContain('id="lobby"');
  });
});
