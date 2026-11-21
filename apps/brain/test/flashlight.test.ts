// Two frames from one live Genie 4 flashlight round (apps/world/robot-v1/fixtures,
// World-owned, read-only here). Over-the-right-shoulder follow camera, chair as
// the obstacle. Runs through full TickRequest validation with the fixture adapter.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { blockingObstacle, feetMidpoint, sideClear, stepNav } from "../server/navigate.js";
import { initialState } from "../server/controller.js";
import { FixturePerception, WORLD_FLASHLIGHT, loadHallwayLabels } from "../server/perception/fixture.js";
import type { Scene } from "../server/perception/types.js";
import { loadPolicy } from "../server/policy.js";
import { TickHandler } from "../server/tick.js";
import { EP, req } from "./helpers.js";

if (!existsSync(join(WORLD_FLASHLIGHT, "labels.json"))) {
  throw new Error(`World's flashlight fixtures are missing at ${WORLD_FLASHLIGHT}; pull main (9081bff or later).`);
}

const policy = loadPolicy("v1");
const labels = loadHallwayLabels(WORLD_FLASHLIGHT);
const byFile = Object.fromEntries(labels.frames.map((f) => [f.file, f]));
const b64 = (file: string) => readFileSync(join(WORLD_FLASHLIGHT, file)).toString("base64");
const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };

const sceneOf = (file: string): Scene => {
  const f = byFile[file]!;
  return {
    feet: f.feet,
    obstacles: f.hazard ? [{ point: f.hazard.point, ...(f.hazard.box ? { box: f.hazard.box } : {}) }] : [],
    goal: f.goal,
    pose: f.stumbling ? "stumbling" : "upright",
  };
};

async function once(file: string) {
  const adapter = new FixturePerception();
  const handler = new TickHandler({ adapter, policy, taskFor: (id) => (id === EP ? task : undefined) });
  const res = await handler.handle(req(0, b64(file)));
  expect(TickResponse.safeParse(res).success).toBe(true);
  expect(adapter.lastSource).toBe("scene");
  return res;
}

describe("live flashlight round: chair as the obstacle", () => {
  it("both frames fit C04's 80 000-char b64 cap", () => {
    for (const f of labels.frames) expect(b64(f.file).length, f.file).toBeLessThanOrEqual(80_000);
  });

  it("chair ahead: the chair blocks walking straight, but the way to the exit is open on its right", () => {
    const scene = sceneOf("chair-ahead.jpg");
    const goal = scene.goal!;
    expect(blockingObstacle(scene, [goal[0], policy.navigation.headingX], policy)).toBeDefined();
    expect(blockingObstacle(scene, goal, policy)).toBeUndefined();
  });

  it("chair ahead: sidesteps right onto the open floor instead of walking into the chair", async () => {
    const res = await once("chair-ahead.jpg");
    expect(res.mode).toBe("track");
    expect(res.action).toEqual({ key: "D", holdMs: 600 });
    expect(res.rationale).toBe("obstacle ahead, stepping right");
    expect(res.perception.hazards).toEqual([{ label: "obstacle", point: byFile["chair-ahead.jpg"]!.hazard!.point }]);
  });

  it("chair left: the chair is beside the robot, not ahead, so it heads for the exit", async () => {
    const scene = sceneOf("chair-left.jpg");
    expect(blockingObstacle(scene, scene.goal!, policy)).toBeUndefined();
    const res = await once("chair-left.jpg");
    expect(res.action.key).toBe("ArrowRight"); // exit at about 1 o'clock
    expect(res.rationale).toBe("exit 1 o'clock → turning");
  });

  it("never claims arrival on either frame, matching World's labels", async () => {
    for (const f of labels.frames) {
      const adapter = new FixturePerception();
      const handler = new TickHandler({ adapter, policy, taskFor: () => task });
      await handler.handle(req(0, b64(f.file)));
      const res = await handler.handle(req(1, b64(f.file)));
      expect(res.successClaim, f.file).toBe(f.arrived);
      const gap = Math.hypot(feetMidpoint(sceneOf(f.file))[0] - f.goal[0], feetMidpoint(sceneOf(f.file))[1] - f.goal[1]);
      expect(gap, f.file).toBeGreaterThan(policy.navigation.arriveRadius);
    }
  });

  it("World's written observations and the chair's kind never reach the player or its perception output", async () => {
    for (const f of labels.frames) {
      const res = await once(f.file);
      const text = JSON.stringify(res).toLowerCase();
      expect(text).not.toContain("chair");
      expect(text).not.toContain("yellow");
    }
  });

  it("chair ahead: the right side is clear for a sidestep", () => {
    const scene = sceneOf("chair-ahead.jpg");
    expect(sideClear(scene, [scene.goal![0], policy.navigation.headingX], "right", policy)).toBe(true);
  });

  it("with preferSidestep off, the old behaviour returns: turn toward the exit", () => {
    const off = { ...policy, navigation: { ...policy.navigation, preferSidestep: false } };
    const r = stepNav(initialState(), sceneOf("chair-ahead.jpg"), req(0), off);
    expect([r.action.key, r.rationale]).toEqual(["ArrowRight", "obstacle ahead, turning toward exit"]);
  });
});

describe("prefer sidestep: edge cases", () => {
  const base = sceneOf("chair-ahead.jpg");
  const chair = base.obstacles[0]!;
  const shifted = (dx: number) => ({ point: [chair.point[0], chair.point[1] + dx] as [number, number], box: [chair.box![0], chair.box![1] + dx, chair.box![2], chair.box![3] + dx] as [number, number, number, number] });

  it("if both sides are blocked, it turns to look for a way instead of stepping into something", () => {
    const boxedIn = { ...base, obstacles: [chair, shifted(-100), shifted(100)] };
    const r = stepNav(initialState(), boxedIn, req(0), policy);
    expect(["ArrowLeft", "ArrowRight"]).toContain(r.action.key);
    expect(r.reaction).toBe("avoid");
  });

  it("an obstacle far down the route doesn't trigger a sidestep yet", () => {
    const far = { ...base, obstacles: [{ point: [500, 470] as [number, number], box: [470, 440, 500, 500] as [number, number, number, number] }] };
    const r = stepNav(initialState(), far, req(0), { ...policy, navigation: { ...policy.navigation, sidestepWithin: 0.6 } });
    expect(["A", "D"]).not.toContain(r.action.key);
  });
});

