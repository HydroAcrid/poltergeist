// Sri's target POV: tight over-the-right-shoulder camera, boots below the frame.
// Uses Brain's SYNTHETIC frames (fixtures/media/fixture-zero/shoulder) and their
// human labels; the robot's ground position is the rig's estimated anchor.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Point } from "@poltergeist/contracts/common.js";
import { initialState } from "../server/controller.js";
import { blockingObstacle, stepNav } from "../server/navigate.js";
import { parseScene } from "../server/perception/er2.js";
import type { Scene } from "../server/perception/types.js";
import { loadPolicy, withRig } from "../server/policy.js";
import { req } from "./helpers.js";

const dir = resolve(__dirname, "../../../fixtures/media/fixture-zero/shoulder");
const labels = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")) as {
  synthetic: boolean;
  frames: { file: string; pose: "upright" | "stumbling"; goal: Point; obstacles: { label: string; box: [number, number, number, number] }[]; expect: string }[];
};
const policy = withRig(loadPolicy("v1"), "shoulder");
const anchor = policy.navigation.shoulder.anchor;
const byFile = Object.fromEntries(labels.frames.map((f) => [f.file, f]));

/** What a perceiver would report for a frame, with the boots hidden. */
const sceneOf = (file: string): Scene => {
  const f = byFile[file]!;
  return {
    feet: { left: [anchor[0], anchor[1] - 15], right: [anchor[0], anchor[1] + 15] },
    feetEstimated: true,
    obstacles: f.obstacles.map((o) => ({ point: [Math.round((o.box[0] + o.box[2]) / 2), Math.round((o.box[1] + o.box[3]) / 2)] as Point, box: o.box })),
    goal: f.goal,
    pose: f.pose,
  };
};
const move = (file: string, state = initialState()) => stepNav(state, sceneOf(file), req(0), policy);

describe("shoulder POV (synthetic frames)", () => {
  it("is labeled as synthetic and every frame fits C04's b64 cap", () => {
    expect(labels.synthetic).toBe(true);
    for (const f of labels.frames) expect(readFileSync(join(dir, f.file)).toString("base64").length).toBeLessThanOrEqual(80_000);
  });

  it.each(["clear-route.jpg", "absent.jpg", "foil-beside.jpg"])("%s: walks ahead (nothing on the route)", (file) => {
    expect(move(file).action.key).toBe("W");
  });

  it("chair-next-step: doesn't step or turn right into the chair", () => {
    expect(["D", "ArrowRight"]).not.toContain(move("chair-next-step.jpg").action.key);
  });

  it("chair-ahead-right-open: the chair is on the route; it moves to the open right side, not into it", () => {
    const s = sceneOf("chair-ahead-right-open.jpg");
    expect(blockingObstacle(s, [s.goal![0], policy.navigation.shoulder.headingX], policy)).toBeDefined();
    const r = move("chair-ahead-right-open.jpg");
    expect(["D", "ArrowRight"]).toContain(r.action.key);
    expect(r.reaction).toBe("avoid");
  });

  it("stumbling: holds still and marks the stumble", () => {
    const r = move("stumbling.jpg");
    expect([r.action.key, r.reaction]).toEqual(["NOOP", "stumble"]);
  });

  it("at-exit: the threshold in the foreground counts as arrival, after two ticks", () => {
    const a = move("at-exit.jpg");
    expect([a.mode, a.successClaim]).toEqual(["success", false]);
    const b = stepNav(a.state, sceneOf("at-exit.jpg"), req(1), policy);
    expect([b.mode, b.successClaim]).toEqual(["success", true]);
    // A far-off exit never counts, even though the "feet" are only an estimate.
    expect(move("clear-route.jpg").successClaim).toBe(false);
  });

  it("foil-crossing: geometry alone treats flat foil as a wall (the open-ended reaction work will judge it)", () => {
    const r = move("foil-crossing.jpg");
    expect(r.action.key).not.toBe("W");
    expect(r.reaction).toBe("avoid");
  });

  it("the trail rig would wrongly claim nothing here: the shoulder rig is needed for this POV", () => {
    const trail = loadPolicy("v1");
    const r = stepNav(initialState(), sceneOf("at-exit.jpg"), req(0), trail);
    expect(r.mode).not.toBe("success");
  });
});

describe("ER 2 parsing with hidden boots", () => {
  const reply = JSON.stringify({ robotVisible: true, obstacles: [], exit: { visible: true, point: [478, 717] }, pose: "upright" });
  it("stands in the rig's anchor and flags it as estimated", () => {
    const p = parseScene(reply, anchor);
    expect(p.scene?.feet).toEqual({ left: [1000, 205], right: [1000, 235] });
    expect(p.scene?.feetEstimated).toBe(true);
  });
  it("with an anchor (shoulder rig), boot points ER 2 guesses for hidden boots are ignored", () => {
    const guessed = JSON.stringify({ robotVisible: true, feet: { left: [990, 180], right: [985, 260] }, obstacles: [], exit: { visible: true, point: [478, 717] }, pose: "upright" });
    expect(parseScene(guessed, anchor).scene?.feet).toEqual({ left: [1000, 205], right: [1000, 235] });
  });
  it("without an anchor (trail rig), hidden boots mean no scene", () => {
    expect(parseScene(reply).scene).toBeUndefined();
  });
});
