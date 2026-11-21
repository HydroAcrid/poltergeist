// "One waiting idea each" (Courtney's call for crowds of hundreds): sending a new idea replaces
// your waiting one; your reserved Up next can't be swapped out; waiting ideas carry over rounds.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrowdState, HauntPublic } from "@poltergeist/contracts/haunt.js";
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
  return {
    state: async () => CrowdState.parse((await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: { cookie } })).json()),
    submit: (body: object) => hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie }, payload: body }),
  };
}
const texts = (list: HauntPublic[]) => list.map((h) => h.moderated?.text);

describe("one waiting idea each", () => {
  it("a new idea replaces your waiting one, privately marked as replaced", async () => {
    const a = await phone();
    await a.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.clock.advance(20_000);
    await a.submit({ preset: "banana-peel" });
    await hub.crowd.whenIdle();
    const s = await a.state();
    expect(texts(s.queue)).toEqual(["A banana peel lands in the aisle"]);
    expect(s.mine.map((h) => h.status)).toEqual(["queued", "withdrawn"]);
    const pub = hub.bus.history({ types: ["haunt.public"] }).map((e) => (e.payload as HauntPublic).status);
    expect(pub).toContain("withdrawn");
  });

  it("other people's waiting ideas are untouched", async () => {
    const a = await phone();
    const b = await phone();
    await a.submit({ preset: "fog" });
    await b.submit({ preset: "lights-flicker" });
    await hub.crowd.whenIdle();
    hub.clock.advance(20_000);
    await a.submit({ preset: "banana-peel" });
    await hub.crowd.whenIdle();
    expect(texts((await b.state()).queue)).toEqual(["The hallway lights flicker and dim", "A banana peel lands in the aisle"]);
  });

  it("your reserved Up next can't be replaced; the new idea is refused without using your rate limit", async () => {
    const a = await phone();
    await a.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    hub.crowd.tick(); // reserves fog as Up next
    hub.clock.advance(20_000);
    const res = await a.submit({ preset: "banana-peel" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/up next/i);
    expect(texts((await a.state()).queue)).toEqual(["Thick fog rolls down the hallway"]);
  });

  it("an idea that already went in doesn't block a new one", async () => {
    const a = await phone();
    await a.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    hub.clock.advance(8_000);
    hub.crowd.tick(); // fog sent
    hub.clock.advance(20_000);
    expect((await a.submit({ preset: "banana-peel" })).statusCode).toBe(200);
    await hub.crowd.whenIdle();
    expect((await a.state()).mine.map((h) => h.status)).toEqual(["queued", "dispatched"]);
  });

  it("in the lobby nothing is reserved, so a guest can keep changing their idea", async () => {
    const a = await phone();
    await a.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.crowd.tick(); // no round yet
    expect((await a.state()).upNext).toBeUndefined();
    hub.clock.advance(20_000);
    expect((await a.submit({ preset: "banana-peel" })).statusCode).toBe(200);
    await hub.crowd.whenIdle();
    expect(texts((await a.state()).queue)).toEqual(["A banana peel lands in the aisle"]);
  });

  it("Up next is reserved once the round is playing, and released when the round ends", async () => {
    const a = await phone();
    await a.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    hub.crowd.tick();
    expect((await a.state()).upNext).toBeDefined();
    hub.world.endEpisode();
    expect((await a.state()).upNext).toBeUndefined();
    hub.crowd.tick();
    expect((await a.state()).upNext).toBeUndefined();
    hub.clock.advance(20_000);
    expect((await a.submit({ preset: "banana-peel" })).statusCode).toBe(200);
  });

  it("a waiting idea carries over to the next round, and phones know how many go per round", async () => {
    const a = await phone();
    hub.world.startEpisode();
    hub.world.endEpisode();
    await a.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    const s = await a.state();
    expect(s.episodeActive).toBe(false);
    expect(s.mine[0]?.status).toBe("queued");
    expect(s.slotsPerRound).toBe(6);
  });
});
