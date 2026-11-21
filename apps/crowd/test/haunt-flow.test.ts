// The two-phone flow (TODO Tier 0): private receipts, private rejections, a shared FIFO queue
// with "Up next", All/Mine, rate limits, and the scheduler sending each idea to World once.
// Runs the real crowd module against an in-memory bus and a fake World; no model calls.
import { gunzipSync } from "node:zlib";
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

  it("privately suggests a revision and sends it straight back through moderation exactly once", async () => {
    const author = await phone();
    const spectator = await phone();
    const parent = (await author.submit({ text: "A hurricane blows the roof off" })).json().hauntId;
    await hub.crowd.whenIdle();

    const feedback = (await author.state()).mine[0]!.moderated!;
    expect(feedback.reason).toBeTruthy();
    expect(feedback.suggestion).toBeTruthy();
    expect((await spectator.state()).mine).toEqual([]);
    expect((await spectator.state()).queue).toEqual([]);
    const events = JSON.stringify(hub.bus.history({ types: ["haunt.public"] }));
    expect(events).not.toMatch(/"reason"|"suggestion"/);
    expect(events).not.toContain(feedback.suggestion);
    const publicParent = hub.bus.history({ types: ["haunt.public"] }).at(-1)!.payload as HauntPublic;
    const legacy = { ...publicParent, moderated: { ...publicParent.moderated!, reason: feedback.reason } };
    expect(HauntPublic.parse(legacy).moderated?.reason).toBeUndefined();
    expect(HauntPublic.safeParse({ ...legacy, moderated: feedback }).success).toBe(false);

    const revision = { text: feedback.suggestion, revisionOf: parent };
    expect((await spectator.submit(revision)).statusCode).toBe(400);
    expect((await author.submit({ preset: "banana-peel", revisionOf: parent })).statusCode).toBe(400);
    const [first, second] = await Promise.all([author.submit(revision), author.submit(revision)]);
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(first.json().hauntId).not.toBe(parent);
    expect((await author.submit({ ...revision, text: "another edit" })).statusCode).toBe(400);
    await hub.crowd.whenIdle();

    const revised = (await author.state()).mine.find(h => h.hauntId === first.json().hauntId);
    expect(revised).toMatchObject({ status: "queued", moderated: { safe: true, model: "rules-only" } });
    expect((await spectator.state()).queue.map(h => h.hauntId)).toEqual([first.json().hauntId]);
    expect(hub.crowd.allHaunts()).toHaveLength(2);
    expect(hub.bus.history({ types: ["haunt.public"] }).map(e => e.payload).filter(
      p => (p as HauntPublic).hauntId === first.json().hauntId && (p as HauntPublic).status === "submitted"
    )).toHaveLength(1);
    expect((await author.submit({ text: "fog" })).statusCode).toBe(429);
  });

  it("checks edited originals and prevents an unlimited chain of immediate rejected revisions", async () => {
    const author = await phone();
    const parent = (await author.submit({ text: "hurricane" })).json().hauntId;
    await hub.crowd.whenIdle();
    const change = (await author.submit({ text: "tornado", revisionOf: parent })).json().hauntId;
    await hub.crowd.whenIdle();
    expect((await author.state()).mine.find(h => h.hauntId === change)?.status).toBe("rejected");
    const next = { text: "Paper flutters across the floor", revisionOf: change };
    expect((await author.submit(next)).statusCode).toBe(429);
    hub.clock.advance(20_000);
    expect((await author.submit(next)).statusCode).toBe(200);
  });

  it("counts an immediate revision against the same device's daily allowance", async () => {
    const author = await phone();
    for (let i = 0; i < 29; i++) {
      expect((await author.submit({ text: "fog" })).statusCode).toBe(200);
      hub.clock.advance(20_000);
    }
    const parent = (await author.submit({ text: "hurricane" })).json().hauntId;
    await hub.crowd.whenIdle();
    const response = await author.submit({ revisionOf: parent, text: "Paper flutters across the floor" });
    expect(response.statusCode).toBe(429);
    expect(response.json().error.message).toMatch(/daily/);
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

    // Everyone's "Hallway" screen shows what went into the world this round, display-safe.
    for (const p of [a, b]) {
      const hallway = (await p.state()).hallway ?? [];
      expect(hallway.map((h) => [h.moderated?.text, h.status])).toEqual([["A banana peel lands in the aisle", "injected"]]);
      expect(JSON.stringify(hallway)).not.toMatch(/raw|deviceId|reason/);
    }

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

  it("only publishes a clock during play in a host-started room", async () => {
    await hub.close();
    hub = await buildTestHub({ config: { roundEveryMs: null } });
    const a = await phone();
    expect(await a.state()).not.toHaveProperty("nextRoundAt");
    const startedAt = hub.clock.now();
    hub.world.startEpisode({ maxDurationMs: 60_000 });
    expect(await a.state()).toMatchObject({ episodeActive: true, roundEndsAt: startedAt + 60_000 });
    hub.world.endEpisode();
    const after = await a.state();
    expect(after).not.toHaveProperty("roundEndsAt");
    expect(after).not.toHaveProperty("nextRoundAt");
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

describe("referee and scoreboard on episode end", () => {
  it("blames the adversary when a visual haunting lands just before the target is lost, then updates the scoreboard", async () => {
    const a = await phone();
    await a.submit({ text: "fog lol" });
    await hub.crowd.whenIdle();
    const episodeId = hub.world.startEpisode({ maxDurationMs: 60_000 });
    const tick = (seq: number, visible: boolean) =>
      hub.bus.publish("tick", "brain", {
        episodeId, seq, t: seq * 500, driver: "brain", framePath: `f/${seq}.jpg`, frameDiff: 0.1,
        perception: { visible, conf: visible ? 0.9 : 0.1, hazards: [], model: "fixture", latencyMs: 600 },
        action: { key: "W", holdMs: 600 }, mode: visible ? "track" : "search", rationale: "walking", successClaim: false, policyVersion: "v1",
      }, episodeId);
    for (let s = 0; s < 16; s++) tick(s, true); // target visible until t = 7.5 s
    hub.clock.advance(8_000);
    hub.crowd.tick(); // fog dispatched at t = 8 s
    await hub.world.flush(); // injected ok
    for (let s = 18; s < 30; s++) tick(s, false); // target lost from t = 9 s
    hub.world.endEpisode("timeout");

    const v = hub.bus.history({ types: ["verdict.provisional"] }).at(-1)!.payload as { blame: string; culpritHauntId: string; failureT: number };
    const fogId = (await a.state()).mine[0]!.hauntId;
    expect(v).toMatchObject({ blame: "adversary", culpritHauntId: fogId, failureT: 9000 });

    const board = (await hub.app.inject({ method: "GET", url: "/api/crowd/scoreboard" })).json();
    expect(board.attacks).toMatchObject({ injected: 1, landed: 1 });
    expect(board.killFeed[0].text).toMatch(/^💀 .+: Thick fog rolls down the hallway → robot lost the target$/);
    expect(hub.bus.history({ types: ["scoreboard.updated"] }).length).toBeGreaterThan(0);
  });
});

describe("operator and page", () => {
  it("serves a self-contained /overlay, its logic module and a join QR", async () => {
    const page = await hub.app.inject({ method: "GET", url: "/overlay" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.body).not.toMatch(/<script[^>]+src="https?:|<link[^>]+stylesheet/);
    expect(page.body).toContain("/overlay-model.js");
    const js = await hub.app.inject({ method: "GET", url: "/overlay-model.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    const qr = await hub.app.inject({ method: "GET", url: "/api/crowd/join.svg", headers: { host: "venue.local:8788" } });
    expect(qr.statusCode).toBe(200);
    expect(qr.headers["content-type"]).toMatch(/image\/svg\+xml/);
    expect(qr.body).toMatch(/^<svg|<\?xml/);
    for (const f of ["ghost-veil.js", "veil-machine.js"]) {
      const v = await hub.app.inject({ method: "GET", url: "/veil/" + f });
      expect(v.statusCode).toBe(200);
      expect(v.headers["content-type"]).toMatch(/javascript/);
    }
  });

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
    const phone = await hub.app.inject({ method: "GET", url: "/haunt", headers: { "accept-encoding": "gzip, deflate, br" } });
    expect(phone.headers["content-encoding"]).toBe("gzip");
    expect(phone.rawPayload.byteLength).toBeLessThan(30_000);
    expect(gunzipSync(phone.rawPayload).toString("utf8")).toBe(page.body);
    expect(page.body).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/);
    expect(page.body).toContain("Approved hauntings may appear on the big screen with your ghost name.");
    expect(page.body).not.toMatch(/id="nick"|payload\.displayName/); // names are assigned, never typed or sent
    // Visible navigation: four screens in a bottom tab bar, each with a next-step link.
    for (const screen of ["haunt", "next", "hallway", "mine"]) {
      expect(page.body).toContain(`id="screen-${screen}"`);
      expect(page.body).toContain(`class="tab" href="#${screen}"`);
    }
    expect(page.body.match(/class="next" href="#/g)?.length).toBe(6); // every screen, sub-pages included, has a next step
    // Sub-pages: "More ideas" (opened from the Haunt screen) and "Sent!" (where you land after sending).
    expect(page.body).toContain('id="screen-ideas"');
    expect(page.body).toContain('class="chip more" href="#ideas"');
    expect(page.body).toContain('id="screen-sent"');
    expect(page.body).toContain('location.hash = "#sent"');
    // Speech to text, shown only where the browser supports it.
    expect(page.body).toContain('id="mic"');
    // One waiting idea each: the replace hint and the replaced label are on the page.
    expect(page.body).toContain('id="replace-hint"');
    expect(page.body).toContain("Replaced by your newer idea");
    expect(page.body).toMatch(/SpeechRecognition \|\| window\.webkitSpeechRecognition/);
    // Delivery (haunt.injected) is only "Sent to the hallway"; "In the hallway" and reaction credit
    // need separate camera evidence (World, #2).
    expect(page.body).toContain('injected: ["Sent to the hallway"');
    expect(page.body).not.toMatch(/Sent to world|idea is in the hallway|>In the hallway</);
  });
});
