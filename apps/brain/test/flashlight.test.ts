// Two frames from one live Genie 4 flashlight round (apps/world/robot-v1/fixtures,
// World-owned, read-only here). Over-the-right-shoulder follow camera, chair as
// the obstacle. Runs through full TickRequest validation with the fixture adapter.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { blockingObstacle, feetMidpoint } from "../server/navigate.js";
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

  it("chair ahead: turns right toward the exit instead of walking into the chair", async () => {
    const res = await once("chair-ahead.jpg");
    expect(res.mode).toBe("track");
    expect(res.action.key).toBe("ArrowRight");
    expect(res.action.key).not.toBe("W");
    expect(res.rationale).toBe("obstacle ahead, turning toward exit");
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
});
