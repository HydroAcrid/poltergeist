// The two-phone flow (TODO Tier 0): private receipts, private rejections, a shared FIFO queue
// with "Up next", All/Mine, rate limits, and the scheduler sending each idea to World once.
// Runs the real crowd module against an in-memory bus and a fake World; no model calls.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrowdState, Haunt, HauntDispatch, HauntPublic, HauntSubmitResponse } from "@poltergeist/contracts/haunt.js";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
beforeEach(async () => {
  hub = await buildTestHub();
});
afterEach(async () => {
  await hub.close();
});

async function phone() {
  const res = await hub.app.inject({ method: "GET", url: "/api/crowd/state" });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  expect(cookie).toMatch(/^pg_device=dv_/);
  const state = async () => {
    const r = await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return CrowdState.parse(r.json());
  };
  const submit = async (body: Record<string, unknown>) =>
    hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie }, payload: body });
  return { cookie, state, submit };
}

const texts = (list: HauntPublic[]) => list.map((h) => h.moderated?.text);

describe("two-phone flow", () => {
  it("gives the author an immediate private receipt and keeps a rejection private", async () => {
    const a = await phone();
    const b = await phone();

    const res = await a.submit({ text: "<CELEB_NAME> walks down the hallway", displayName: "ana" });
    expect(res.statusCode).toBe(200);
    const receipt = HauntSubmitResponse.parse(res.json());
    expect(receipt.status).toBe("submitted"); // shown as "Checking" before moderation finishes

    await hub.crowd.whenIdle();
    const mine = (await a.state()).mine;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ hauntId: receipt.hauntId, status: "rejected", moderated: { safe: false, text: "" } });
    expect(mine[0]!.moderated!.reason).toBe("Keep it about the hallway, not people.");

    const bState = await b.state();
    expect(bState.mine).toEqual([]);
    expect(bState.queue).toEqual([]);
    expect(JSON.stringify(bState)).not.toContain("CELEB_NAME");
  });

  it("shows approved ideas on both phones in FIFO order, with Mine as a filter", async () => {
    const a = await phone();
    const b = await phone();

    await b.submit({ preset: "banana-peel", displayName: "bo" });
    hub.clock.advance(1000);
    await a.submit({ text: "fog lol", displayName: "ana" });
    await hub.crowd.whenIdle();

    const names = [(await b.state()).you?.ghostName, (await a.state()).you?.ghostName];
    for (const p of [a, b]) {
      const s = await p.state();
      expect(texts(s.queue)).toEqual(["A banana peel lands in the aisle", "Thick fog rolls down the hallway"]);
      expect(s.queue.map((h) => h.displayName)).toEqual(names); // assigned ghost names, not the typed ones
      for (const h of s.queue) expect(h.moderated?.reason).toBeUndefined();
    }
    // "Mine" = queue items whose ids are in the caller's own list.
    const aState = await a.state();
    const mineIds = new Set(aState.mine.map((h) => h.hauntId));
    expect(texts(aState.queue.filter((h) => mineIds.has(h.hauntId)))).toEqual(["Thick fog rolls down the hallway"]);
    expect(aState.mine[0]?.status).toBe("queued");

    // Refresh on reconnect returns the same server-side view.
    expect(await a.state()).toEqual(aState);
  });

  it("breaks createdAt ties by haunt id", async () => {
    const a = await phone();
    const b = await phone();
    await a.submit({ text: "the lights flicker" });
    await b.submit({ text: "smoke fills the corridor" });
    await hub.crowd.whenIdle();
    const q = (await a.state()).queue;
    expect(q).toHaveLength(2);
    expect(q.map((h) => h.hauntId)).toEqual([...q.map((h) => h.hauntId)].sort());
  });

  it("rate-limits to one idea per 20 s per device, with a friendly RATE_LIMITED error", async () => {
    const a = await phone();
    expect((await a.submit({ text: "fog" })).statusCode).toBe(200);
    const limited = await a.submit({ text: "smoke fills the hall" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(limited.json().error.message).toMatch(/seconds/);
    hub.clock.advance(20_000);
    expect((await a.submit({ text: "smoke fills the hall" })).statusCode).toBe(200);
  });

  it("caps each device at 30 ideas per day", async () => {
    const a = await phone();
    for (let i = 0; i < 30; i++) {
      expect((await a.submit({ text: "fog" })).statusCode).toBe(200);
      hub.clock.advance(20_000);
    }
    const res = await a.submit({ text: "fog" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toMatch(/today/);
  });

  it("takes the device id from the cookie only, and validates the body", async () => {
    const a = await phone();
    await a.submit({ text: "fog", deviceId: "dv_spoofedspoofedspoo" });
    await hub.crowd.whenIdle();
    const all = hub.crowd.allHaunts();
    expect(all[0]?.deviceId).toBe(a.cookie.replace("pg_device=", ""));

    expect((await a.submit({ text: "x".repeat(81) })).json()).toMatchObject({ error: { code: "INVALID" } });
    expect((await a.submit({ preset: "no-such-preset" })).json()).toMatchObject({ error: { code: "INVALID" } });
    expect((await a.submit({})).json()).toMatchObject({ error: { code: "INVALID" } });
  });

  it("never shows a client-supplied nickname, even an unsafe one", async () => {
    const a = await phone();
    await a.submit({ text: "fog", displayName: "<SLUR>" });
    await hub.crowd.whenIdle();
    const s = await a.state();
    expect(s.queue[0]?.displayName).toBe(s.you?.ghostName);
  });
});

describe("scheduler and fake World", () => {
  it("sends the first eligible idea once at t ≥ 8 s, then one per interval, and tracks World's confirmation", async () => {
    const a = await phone();
    const b = await phone();
    await b.submit({ preset: "banana-peel" });
    hub.clock.advance(1000);
    await a.submit({ text: "fog lol" });
    await hub.crowd.whenIdle();

    const episodeId = hub.world.startEpisode();
    hub.clock.advance(7_999);
    hub.crowd.tick();
    expect(hub.dispatched()).toHaveLength(0);

    hub.clock.advance(1);
    hub.crowd.tick();
    hub.crowd.tick(); // a second tick in the same instant must not resend
    const sent = hub.dispatched();
    expect(sent).toHaveLength(1);
    expect(HauntDispatch.parse(sent[0])).toMatchObject({ episodeId, text: "A banana peel lands in the aisle" });

    // While waiting for World: b sees "dispatched"; the queue now starts with a's fog ("Up next").
    expect((await b.state()).mine[0]?.status).toBe("dispatched");
    expect(texts((await a.state()).queue)).toEqual(["Thick fog rolls down the hallway"]);

    await hub.world.flush(); // fake World answers haunt.injected { ok: true, simulated: true }
    expect((await b.state()).mine[0]).toMatchObject({ status: "injected", episodeId, injectedT: 8000 });

    hub.clock.advance(11_999);
    hub.crowd.tick();
    expect(hub.dispatched()).toHaveLength(1);
    hub.clock.advance(1);
    hub.crowd.tick();
    expect(hub.dispatched()).toHaveLength(2);
  });

  it("tells phones when the live round ends, and when the next one starts once it's over", async () => {
    const a = await phone();
    const idle = await a.state();
    expect(idle.episodeActive).toBe(false);
    expect(idle.roundEndsAt).toBeUndefined();
    expect(idle.nextRoundAt).toBeGreaterThan(hub.clock.now());

    const startedAt = hub.clock.now();
    hub.world.startEpisode({ maxDurationMs: 60_000 });
    const live = await a.state();
    expect(live).toMatchObject({ episodeActive: true, round: 1, roundEndsAt: startedAt + 60_000 });
    expect(live.nextRoundAt).toBeUndefined();

    hub.world.endEpisode();
    const after = await a.state();
    expect(after.roundEndsAt).toBeUndefined();
    expect(after.round).toBe(1);
  });

  it("treats a round that runs past its deadline with no episode.ended as over (interrupted, no winner)", async () => {
    const a = await phone();
    await a.submit({ text: "fog lol" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode({ maxDurationMs: 30_000 });
    hub.world.current = null; // World's stream dies: no episode.ended ever arrives
    hub.clock.advance(30_000 + 5_000); // deadline + 5 s grace
    hub.crowd.tick();
    expect(hub.dispatched()).toHaveLength(0); // nothing is sent into a dead round
    const s = await a.state();
    expect(s.episodeActive).toBe(false);
    expect(s.roundEndsAt).toBeUndefined();
    expect(s.queue).toHaveLength(1); // the idea waits for the next round
  });

  it("marks a failed injection as failed and never retries it", async () => {
    const a = await phone();
    await a.submit({ text: "fog lol" });
    await hub.crowd.whenIdle();
    hub.world.failNext = true;
    hub.world.startEpisode();
    hub.clock.advance(8_000);
    hub.crowd.tick();
    await hub.world.flush();
    expect((await a.state()).mine[0]?.status).toBe("failed");
    hub.clock.advance(60_000);
    hub.crowd.tick();
    expect(hub.dispatched().filter((d) => (d as { text: string }).text === "Thick fog rolls down the hallway")).toHaveLength(1);
  });

  it("stops at the per-episode cap and after the episode ends; uses the seeded pool when the queue is empty", async () => {
    hub.world.startEpisode({ maxDurationMs: 90_000 });
    for (let i = 0; i < 7; i++) {
      hub.clock.advance(12_000);
      hub.crowd.tick();
    }
    const sent = hub.dispatched();
    expect(sent).toHaveLength(6); // PG_HAUNT_MAX_PER_EPISODE default
    expect(hub.crowd.allHaunts().filter((h) => h.seeded && h.status === "dispatched")).toHaveLength(6);

    hub.world.endEpisode();
    hub.clock.advance(60_000);
    hub.crowd.tick();
    expect(hub.dispatched()).toHaveLength(6);
  });

  it("never puts raw text or device ids on the bus", async () => {
    const a = await phone();
    await a.submit({ text: "<CELEB_NAME> trips" });
    hub.clock.advance(20_000);
    await a.submit({ text: "fog lol" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    hub.clock.advance(8_000);
    hub.crowd.tick();
    await hub.world.flush();

    const crowdEvents = hub.bus.history({}).filter((e) => e.source === "crowd");
    expect(crowdEvents.length).toBeGreaterThan(0);
    for (const e of crowdEvents) {
      const s = JSON.stringify(e.payload);
      expect(s).not.toContain("CELEB_NAME");
      expect(s).not.toContain("fog lol");
      expect(s).not.toContain(a.cookie.replace("pg_device=", ""));
      if (e.type === "haunt.public") HauntPublic.parse(e.payload);
    }
    const statuses = crowdEvents.filter((e) => e.type === "haunt.public").map((e) => (e.payload as HauntPublic).status);
    expect(statuses).toEqual(expect.arrayContaining(["rejected", "approved", "queued", "dispatched", "injected"]));
  });
});

describe("operator and page", () => {
  it("serves the raw queue only with the operator token", async () => {
    const a = await phone();
    await a.submit({ text: "fog lol" });
    await hub.crowd.whenIdle();
    expect((await hub.app.inject({ method: "GET", url: "/api/crowd/queue" })).statusCode).toBe(401);
    const res = await hub.app.inject({ method: "GET", url: "/api/crowd/queue", headers: { "x-pg-token": hub.operatorToken } });
    expect(res.statusCode).toBe(200);
    const list = Haunt.array().parse(res.json());
    expect(list[0]?.raw).toBe("fog lol");
  });

  it("holds approvals for the operator in finals approval mode", async () => {
    const a = await phone();
    hub.world.operator({ cmd: "finals.approvalMode", on: true });
    await a.submit({ text: "fog lol" });
    await hub.crowd.whenIdle();
    expect((await a.state()).mine[0]?.status).toBe("approved");
    expect((await a.state()).queue).toEqual([]);
    hub.world.operator({ cmd: "haunt.approve", hauntId: (await a.state()).mine[0]!.hauntId });
    expect((await a.state()).mine[0]?.status).toBe("queued");
  });

  it("serves presets and a tiny self-contained /haunt page", async () => {
    const presets = (await hub.app.inject({ method: "GET", url: "/api/crowd/presets" })).json();
    expect(presets[0]).toMatchObject({ id: "banana-peel", label: "Drop a banana peel" });
    const page = await hub.app.inject({ method: "GET", url: "/haunt" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.body.length).toBeLessThan(30_000);
    expect(page.body).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/);
    expect(page.body).toContain("Approved hauntings may appear on the big screen with your ghost name.");
    expect(page.body).not.toMatch(/id="nick"|payload\.displayName/); // names are assigned, never typed or sent
  });
});
