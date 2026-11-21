// World's real rehearsal bodies → the conductor's scene.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kindOf } from "../server/conductor.js";
import { createRehearsalSceneSource, sceneFromRehearsal } from "../server/scene.js";

const load = (f: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", f), "utf8"));

describe("sceneFromRehearsal", () => {
  it("playing body: robot progress from depth, time left from the deadline, the paper storm just ahead in its lane", () => {
    const body = load("rehearsal-playing.json");
    const s = sceneFromRehearsal(body, body.now)!;
    expect(s.robotProgress).toBeCloseTo(0.1867, 3);
    expect(s.timeRemainingMs).toBe(body.round.deadline - body.now);
    expect(s.cameraStable).toBe(true);
    expect(s.obstacles).toEqual([{ label: "paper storm", kind: "airborne", inBeam: true, progress: body.round.props[0].depth }]);
    expect(s.producible).not.toContain("overhead");
  });

  it("opening body: a scene with no obstacles and the round's time still ahead", () => {
    const body = load("rehearsal-opening.json");
    const s = sceneFromRehearsal(body, body.now)!;
    expect(s.obstacles).toEqual([]);
    expect(s.timeRemainingMs).toBe(60_000);
  });

  it("off-path props are never 'in the beam'; seen props are reported", () => {
    const body = load("rehearsal-playing.json");
    Object.assign(body.round.props[0], { placement: "off-path", seen: true });
    const s = sceneFromRehearsal(body, body.now)!;
    expect(s.obstacles[0]!.inBeam).toBe(false);
    expect(s.seenHauntIds).toEqual(["ht_01M7ZQ0D7XEXJ2KFTXE5KEMT0C"]);
  });

  it("uses dated visual evidence in a live session", () => {
    const r = { phase: "playing", live: true, observed: 7, trackedAt: 1500, trackedBody: [20, 40, 280, 180],
      props: [{ id: "penguin", kind: "chair", acked: true, seen: false, inPath: false, confirmedFrame: 0 }] };
    expect(sceneFromRehearsal(r, 2000)).toMatchObject({ observedAt: 1500, cameraStable: true, obstacles: [], seenHauntIds: [] });
    expect(sceneFromRehearsal(r, 2000)?.verifiedPathHauntIds).toEqual([]);
    expect(sceneFromRehearsal(r, 2000)?.robotProgress).toBeUndefined();
    Object.assign(r.props[0]!, { seen: true, inPath: true, confirmedFrame: 7 });
    expect(sceneFromRehearsal(r, 2000)?.obstacles).toEqual([{ label: "chair", kind: "floor_prop", inBeam: true }]);
    expect(sceneFromRehearsal(r, 2000)?.verifiedPathHauntIds).toEqual(["penguin"]);
    expect(sceneFromRehearsal({ ...r, observed: 8 }, 2000)?.verifiedPathHauntIds).toEqual([]);
    expect(sceneFromRehearsal({ ...r, props: [{...r.props[0], seen:true, inPath:false}] }, 2000)?.verifiedPathHauntIds).toEqual([]);
    expect(sceneFromRehearsal({ ...r, observed: 8, props: [{...r.props[0], inPath:false, inPathPresentedAt:1550}] }, 2000)?.verifiedPathHauntIds).toEqual(["penguin"]);
    expect(sceneFromRehearsal({ ...r, observed: 8 }, 2000)?.obstacles).toEqual([]);
    expect(sceneFromRehearsal({ ...r, trackedBody: null }, 2000)?.cameraStable).toBe(false);
    expect(sceneFromRehearsal({ ...r, lastCameraAt: 1650 }, 2000)?.cameraStable).toBe(false);
    expect(sceneFromRehearsal(r, 5000)).toBeUndefined();
    expect(kindOf({ tags: ["distractor"], text: "A windup penguin waddles across the floor" })).toBe("floor_prop");
  });

  it("no scene outside a round (lobby, ended) or for junk", () => {
    expect(sceneFromRehearsal({ round: { phase: "ended" } }, 1)).toBeUndefined();
    expect(sceneFromRehearsal({ round: { phase: "lobby" } }, 1)).toBeUndefined();
    expect(sceneFromRehearsal(null, 1)).toBeUndefined();
  });
});

describe("createRehearsalSceneSource", () => {
  it("serves the latest scene and goes stale (→ FIFO) when World stops answering", async () => {
    const body = load("rehearsal-playing.json");
    let t = body.now;
    let up = true;
    const fetchImpl = (async () => (up ? { ok: true, json: async () => body } : Promise.reject(new Error("down")))) as unknown as typeof fetch;
    const src = createRehearsalSceneSource("http://world/rehearsal/state", { fetchImpl, now: () => t, intervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(src.scene()?.obstacles).toHaveLength(1);
    up = false;
    t += 3001;
    expect(src.scene()).toBeUndefined();
    src.stop();
  });
});
