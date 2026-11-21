// The conductor wired into the live scheduler: one stable reserved pick, re-picked only when it
// becomes impossible; FIFO whenever there is no fresh scene.
import { afterEach, describe, expect, it } from "vitest";
import { CrowdState } from "@poltergeist/contracts/haunt.js";
import type { SceneObservation } from "../server/conductor.js";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
afterEach(async () => {
  await hub.close();
});

let scene: SceneObservation | undefined;
// Like the real source, every read is stamped "now"; `scene = undefined` simulates World going silent.
const live = () => (scene ? { ...scene, observedAt: hub.clock.now() } : undefined);
const mkScene = (p: Partial<SceneObservation>): SceneObservation => ({
  t: 0, observedAt: hub.clock.now(), robotProgress: 0.2, timeRemainingMs: 50_000, cameraStable: true, obstacles: [],
  producible: ["floor_prop", "airborne", "lighting", "visibility", "sign", "audio", "other"], seenHauntIds: [], ...p,
});
const chairInBeam = { label: "chair", kind: "floor_prop" as const, inBeam: true, progress: 0.35 };

async function phone() {
  const res = await hub.app.inject({ method: "GET", url: "/api/crowd/state" });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  return {
    page: async () => CrowdState.parse((await hub.app.inject({ method: "GET", url: "/api/crowd/state?waitingPage=0", headers: { cookie } })).json()),
    state: async () => CrowdState.parse((await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: { cookie } })).json()),
    submit: (body: object) => hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie }, payload: body }),
  };
}
const sentTexts = () => hub.dispatched().map((d) => (d as { text: string }).text);

describe("conductor in the scheduler", () => {
  it("skips an idea that would repeat what's in the beam, sends a fresh one, and tells phones why", async () => {
    hub = await buildTestHub({ scene: live });
    const a = await phone();
    const b = await phone();
    await a.submit({ preset: "chair-tips" }); // oldest: FIFO would send it first
    hub.clock.advance(3_000);
    await b.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    scene = mkScene({ obstacles: [chairInBeam] });
    hub.crowd.tick(); // reserve

    const s = await a.state();
    expect(s.upNext).toMatchObject({ reason: "It will roll right through the flashlight beam", mode: "conductor" });
    expect(s.queue[0]!.moderated?.text).toBe("Thick fog rolls down the hallway"); // the reserved pick leads the queue
    expect(s.holds).toContainEqual(expect.objectContaining({ reason: "A chair already fills the beam" }));

    const paged = await a.page();
    expect(paged.waiting).toMatchObject({ page: 0, size: 15, total: 1 });
    expect(paged.upNext).toEqual(s.upNext);
    expect(paged.waitingReasons).toEqual(s.waiting);

    hub.clock.advance(8_000);
    hub.crowd.tick();
    expect(sentTexts()).toEqual(["Thick fog rolls down the hallway"]);
  });

  it("clears a hold reason once the idea becomes possible again", async () => {
    hub = await buildTestHub({ scene: live });
    const a = await phone();
    const b = await phone();
    await a.submit({ preset: "fog" });
    hub.clock.advance(3_000);
    await b.submit({ preset: "chair-tips" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    scene = mkScene({ obstacles: [chairInBeam] });
    hub.crowd.tick();
    expect((await a.state()).holds).toContainEqual(expect.objectContaining({ reason: "A chair already fills the beam" }));
    scene = mkScene({ robotProgress: 0.5, obstacles: [{ ...chairInBeam, inBeam: false }] }); // robot walked past it
    hub.crowd.tick();
    expect((await a.state()).holds ?? []).toEqual([]);
  });

  it("keeps Up next stable when newer ideas arrive", async () => {
    hub = await buildTestHub({ scene: live });
    const a = await phone();
    const b = await phone();
    hub.world.startEpisode();
    scene = mkScene({});
    await a.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.crowd.tick();
    const first = (await a.state()).upNext?.hauntId;
    hub.clock.advance(3_000);
    await b.submit({ preset: "lights-flicker" }); // also a fine pick, but Up next is already reserved
    await hub.crowd.whenIdle();
    hub.crowd.tick();
    expect((await a.state()).upNext?.hauntId).toBe(first);
  });

  it("re-picks if the reserved idea becomes impossible before its slot", async () => {
    hub = await buildTestHub({ scene: live });
    const a = await phone();
    const b = await phone();
    await a.submit({ preset: "banana-peel" });
    hub.clock.advance(3_000);
    await b.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    scene = mkScene({ robotProgress: 0.3 });
    hub.crowd.tick();
    expect((await a.state()).upNext?.reason).toBe("The aisle ahead is open and the beam will catch it"); // banana reserved
    hub.clock.advance(5_000);
    scene = mkScene({ robotProgress: 0.75 }); // too far along for a floor prop
    hub.clock.advance(3_000);
    hub.crowd.tick();
    expect(sentTexts()).toEqual(["Thick fog rolls down the hallway"]);
    expect((await a.state()).holds).toContainEqual(expect.objectContaining({ reason: "Too close to the exit for this one" }));
  });

  it("never sends an idea this camera can't show; it stays queued", async () => {
    hub = await buildTestHub({ scene: live });
    const a = await phone();
    await a.submit({ text: "dust falls from the ceiling" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    scene = mkScene({});
    hub.clock.advance(8_000);
    hub.crowd.tick();
    hub.clock.advance(12_000);
    hub.crowd.tick();
    expect(sentTexts().filter((t) => /ceiling/i.test(t))).toEqual([]);
    expect((await a.state()).mine[0]?.status).toBe("queued");
  });

  it("upgrades a FIFO pick made before the scene arrived", async () => {
    hub = await buildTestHub({ scene: live });
    const a = await phone();
    const b = await phone();
    await a.submit({ preset: "chair-tips" });
    hub.clock.advance(3_000);
    await b.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    scene = undefined;
    hub.world.startEpisode();
    hub.crowd.tick();
    expect((await a.state()).upNext).toMatchObject({ mode: "fifo" });
    scene = mkScene({ obstacles: [chairInBeam] }); // World's scene comes online
    hub.crowd.tick();
    expect((await a.state()).upNext).toMatchObject({ mode: "conductor", reason: "It will roll right through the flashlight beam" });
  });

  it("falls back to FIFO when World's scene goes stale", async () => {
    hub = await buildTestHub({ scene: live });
    const a = await phone();
    const b = await phone();
    await a.submit({ preset: "chair-tips" });
    hub.clock.advance(3_000);
    await b.submit({ preset: "fog" });
    await hub.crowd.whenIdle();
    hub.world.startEpisode();
    scene = undefined; // no scene: FIFO
    hub.clock.advance(8_000);
    hub.crowd.tick();
    expect(sentTexts()).toEqual(["A chair tips over in the middle of the aisle"]);
    expect((await a.state()).upNext?.mode ?? "fifo").toBe("fifo");
  });
});
