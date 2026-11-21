// Conductor v0: the three-proposal trace (chair, fog, and an impressive idea the shot can't show),
// plus the rules and fallbacks. This is the trace posted on #2.
import { describe, expect, it } from "vitest";
import { conduct, kindOf, POLICY, REASON, withAgent, type Candidate, type RecentHaunt, type SceneObservation } from "../server/conductor.js";

const T0 = new Date("2026-11-21T15:00:00").getTime(); // round starts
const at = (s: number) => T0 + s * 1000;
const cand = (id: string, s: number, text: string, tags: Candidate["tags"], preset?: string): Candidate => ({
  hauntId: id, createdAt: at(s), text, tags, ...(preset ? { preset } : {}), skips: 0, authorPicksThisRound: 0,
});

const chair = cand("ht_A", -40, "A chair tips over in the middle of the aisle", ["geometry"], "chair-tips");
const fog = cand("ht_B", -25, "Thick fog rolls down the hallway", ["visibility", "weather"], "fog");
const chandelier = cand("ht_C", -14, "A chandelier crashes down from the ceiling", ["geometry", "distractor"]);
const peel = cand("ht_D", -10, "A banana peel lands in the aisle", ["distractor", "geometry"], "banana-peel");

const SHOT: SceneObservation["producible"] = ["floor_prop", "airborne", "lighting", "visibility", "sign", "audio"]; // over-shoulder camera: no ceiling
const scene = (s: number, p: Partial<SceneObservation>): SceneObservation => ({
  t: s * 1000, observedAt: at(s), robotProgress: 0.3, timeRemainingMs: 60_000 - s * 1000, cameraStable: true,
  obstacles: [], producible: SHOT, seenHauntIds: [], ...p,
});
const isSafe = (r: string) => r.length <= 60 && !/[<>]/.test(r);

describe("trace: three approved ideas", () => {
  // A seeded chair (ht_S) was sent at 8 s, seen at 10 s, and sits several strides ahead in the beam.
  const recent0: RecentHaunt[] = [{ hauntId: "ht_S", kind: "floor_prop", primaryTag: "geometry", sentAt: at(8), seen: true }];

  it("reserve at 8 s for the 20 s slot: fog. The chair would hide the chair; the chandelier isn't in the shot", () => {
    const d = conduct([chair, fog, chandelier], scene(8, { robotProgress: 0.18, obstacles: [{ label: "chair", kind: "floor_prop", inBeam: true, progress: 0.45 }] }), recent0, at(8));
    expect(d.mode).toBe("conductor");
    expect(d.pick).toEqual({ hauntId: "ht_B", reason: "It will roll right through the flashlight beam" });
    expect(d.waiting).toEqual([
      { hauntId: "ht_A", code: "redundant", reason: "A chair already fills the beam" },
      { hauntId: "ht_C", code: "not_in_shot", reason: "Great idea, but this camera can't show it" },
    ]);
  });

  it("reserve at 20 s for the 32 s slot: the robot has passed the chair, so the chair idea gets its turn", () => {
    const recent = [...recent0, { hauntId: "ht_B", kind: "visibility" as const, primaryTag: "visibility" as const, sentAt: at(20), seen: true }];
    const d = conduct([{ ...chair, skips: 1 }, { ...chandelier, skips: 1 }], scene(20, { robotProgress: 0.48 }), recent, at(20));
    expect(d.pick).toEqual({ hauntId: "ht_A", reason: REASON.floor_prop });
    expect(d.waiting).toEqual([{ hauntId: "ht_C", code: "not_in_shot", reason: "Great idea, but this camera can't show it" }]);
  });

  it("reserve at 32 s: nothing the shot can show is left; the chandelier stays pending for a room that can show it", () => {
    const d = conduct([{ ...chandelier, skips: 2 }], scene(32, { robotProgress: 0.6 }), [], at(32));
    expect(d.pick).toBeUndefined();
    expect(d.waiting).toEqual([{ hauntId: "ht_C", code: "not_in_shot", reason: "Great idea, but this camera can't show it" }]);
  });
});

describe("rules", () => {
  it("too late: floor props stop once the robot is 70% of the way to the exit", () => {
    const d = conduct([peel], scene(44, { robotProgress: 0.74 }), [], at(44));
    expect(d.waiting).toEqual([{ hauntId: "ht_D", code: "too_late", reason: "Too close to the exit for this one" }]);
  });

  it("starvation: an idea passed over twice goes first if it's feasible", () => {
    const d = conduct([{ ...peel, skips: 2 }, fog], scene(20, { robotProgress: 0.4 }), [], at(20));
    expect(d.pick?.hauntId).toBe("ht_D");
  });

  it("fair airtime: an author with no pick yet this round beats one who already had a pick", () => {
    const d = conduct([{ ...fog, authorPicksThisRound: 1 }, { ...peel, tags: ["visibility"] }], scene(20, { robotProgress: 0.3 }), [], at(20));
    expect(d.pick?.hauntId).toBe("ht_D");
  });

  it("variety: an effect unlike the last two beats a repeat; ties go to the oldest idea", () => {
    const recent: RecentHaunt[] = [{ hauntId: "x", kind: "visibility", primaryTag: "visibility", sentAt: at(5), seen: true }];
    expect(conduct([fog, peel], scene(20, { robotProgress: 0.3 }), recent, at(20)).pick?.hauntId).toBe("ht_D");
    expect(conduct([fog, peel], scene(20, { robotProgress: 0.3 }), [], at(20)).pick?.hauntId).toBe("ht_B");
  });

  it("waits for the last same-kind trick to be seen before stacking another", () => {
    const d = conduct([peel], scene(20, {}), [{ hauntId: "x", kind: "floor_prop", primaryTag: "geometry", sentAt: at(15), seen: false }], at(20));
    expect(d.waiting[0]).toMatchObject({ code: "landing" });
  });

  it("holds every idea while the camera is unsteady, and sends nothing new in the last 10 s", () => {
    expect(conduct([fog, peel], scene(20, { cameraStable: false }), [], at(20)).waiting.map((w) => w.code)).toEqual(["no_view", "no_view"]);
    expect(conduct([fog], scene(51, { timeRemainingMs: 9_000 }), [], at(51)).pick).toBeUndefined();
  });

  it("falls back to plain FIFO with no scene or a stale one", () => {
    expect(conduct([peel, fog, chair], undefined, [], at(20))).toMatchObject({ mode: "fifo", pick: { hauntId: "ht_A", reason: "Next in line" } });
    const stale = scene(10, {});
    expect(conduct([peel, fog], stale, [], stale.observedAt + POLICY.sceneMaxAgeMs + 1).mode).toBe("fifo");
  });

  it("classifies effects from presets, tags and text", () => {
    expect(kindOf(peel)).toBe("floor_prop");
    expect(kindOf(fog)).toBe("visibility");
    expect(kindOf(chandelier)).toBe("overhead");
    expect(kindOf({ tags: ["distractor"], text: "balloons drift across the hall" })).toBe("airborne");
  });

  it("every fixed public reason fits the display limit", () => {
    for (const r of Object.values(REASON)) expect(r.length).toBeLessThanOrEqual(60);
  });
});

describe("managed agent ranking", () => {
  const d = conduct([fog, peel], scene(20, { robotProgress: 0.3 }), [], at(20));

  it("takes the agent's first feasible id and its reason if the reason is display-safe", async () => {
    const r = await withAgent(d, async () => [{ hauntId: "ht_X", reason: "not feasible" }, { hauntId: "ht_D", reason: "The peel lands right in the beam" }], isSafe);
    expect(r).toMatchObject({ agentUsed: true, pick: { hauntId: "ht_D", reason: "The peel lands right in the beam" } });
    expect(r.waiting).toContainEqual(expect.objectContaining({ hauntId: "ht_B", code: "ranked_lower" }));
  });

  it("shows a neutral reason when the agent's reason isn't display-safe", async () => {
    const r = await withAgent(d, async () => [{ hauntId: "ht_D", reason: "<CELEB_NAME> would love this" }], isSafe);
    expect(r.pick).toEqual({ hauntId: "ht_D", reason: "Picked for this moment" });
  });

  it("keeps the deterministic pick when the agent is slow, errors, or names only infeasible ideas", async () => {
    expect(await withAgent(d, () => new Promise((r) => setTimeout(() => r([{ hauntId: "ht_D", reason: "x" }]), 50)), isSafe, 10)).toMatchObject({ agentUsed: false, pick: d.pick });
    expect(await withAgent(d, async () => { throw new Error("down"); }, isSafe)).toMatchObject({ agentUsed: false, pick: d.pick });
    expect(await withAgent(d, async () => [{ hauntId: "ht_A", reason: "x" }], isSafe)).toMatchObject({ agentUsed: false, pick: d.pick });
  });
});
