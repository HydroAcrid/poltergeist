// Decision mode "model" with a fake model: the model's choice drives the move,
// geometry vetoes only steps into something it judged solid, and fixed rules
// keep stumbles and arrival. No network.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { Er2Perception, buildDecisionPrompt, type GenAiLike } from "../server/perception/er2.js";
import { loadPolicy, withDecision, withRig } from "../server/policy.js";
import { TickHandler } from "../server/tick.js";
import { req } from "./helpers.js";

const policy = withDecision(withRig(loadPolicy("v1"), "shoulder"), "model");
const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };
const dir = resolve(__dirname, "../../../fixtures/media/fixture-zero/shoulder");
const b64 = (f: string) => readFileSync(join(dir, f)).toString("base64");
const EXIT = [478, 717];
// Solid, on the route, touching the floor within the next steps (~38% of the way to the exit row).
const NEAR_SOLID = [650, 350, 800, 460];
const FOIL_ACROSS = [555, 305, 778, 1000];

const reply = (o: Record<string, unknown>) =>
  JSON.stringify({ robotVisible: true, obstacles: [], exit: { visible: true, point: EXIT }, pose: "upright", change: "nothing", intent: "walk", reason: "path clear", avoiding: false, ...o });

function fake(...texts: string[]) {
  const calls: { contents: any; config: any }[] = [];
  const client: GenAiLike = { models: { async generateContent(r) { calls.push(r); return { text: texts.shift() ?? texts.at(-1) ?? "" }; } } };
  return { client, calls };
}
function handler(...texts: string[]) {
  const f = fake(...texts);
  const adapter = new Er2Perception(f.client, "test", undefined, policy.navigation.shoulder.anchor);
  return { h: new TickHandler({ adapter, policy, taskFor: () => task }), calls: f.calls };
}
async function second(text: string) {
  const { h, calls } = handler(reply({}), text);
  await h.handle(req(0, b64("clear-route.jpg")));
  const res = await h.handle(req(1, b64("foil-crossing.jpg")));
  expect(TickResponse.safeParse(res).success).toBe(true);
  return { res, calls };
}

describe("decision prompt", () => {
  const first = buildDecisionPrompt({ frame: { mime: "image/jpeg", width: 640, height: 360, b64: "A" }, ...task });
  const later = buildDecisionPrompt({ frame: { mime: "image/jpeg", width: 640, height: 360, b64: "B" }, previousFrame: { mime: "image/jpeg", width: 640, height: 360, b64: "A" }, ...task });

  it("names no object and carries no audience text (no per-event rules)", () => {
    for (const p of [first, later]) {
      const t = p.toLowerCase();
      for (const w of ["foil", "chair", "banana", "peel", "paper", "bucket", "ghost", "haunt", "audience", "prompt", "preset"]) expect(t).not.toContain(w);
    }
  });

  it("is identical for every event once a previous frame exists: only the images change", () => {
    const other = buildDecisionPrompt({ frame: { mime: "image/jpeg", width: 640, height: 360, b64: "C" }, previousFrame: { mime: "image/jpeg", width: 640, height: 360, b64: "D" }, ...task });
    expect(other).toBe(later);
  });
});

describe("decision mode through the tick handler", () => {
  it("sends the previous frame and the current frame, in that order, from the second tick", async () => {
    const { calls } = await second(reply({}));
    expect(calls[0]!.contents[0].parts.filter((p: any) => p.inlineData)).toHaveLength(1);
    const imgs = calls[1]!.contents[0].parts.filter((p: any) => p.inlineData).map((p: any) => p.inlineData.data);
    expect(imgs).toEqual([b64("clear-route.jpg"), b64("foil-crossing.jpg")]);
    expect(calls[1]!.config.responseJsonSchema.required).toContain("intent");
  });

  it("walks over something the model judged not solid, as the model chose", async () => {
    const { res } = await second(reply({ obstacles: [{ label: "shiny strip", box: FOIL_ACROSS, solid: false }], change: "a flat shiny strip appeared across the floor", intent: "walk", reason: "flat strip, stepping over it", avoiding: false, target: [700, 520] }));
    expect(res.action.key).toBe("W");
    expect(res.rationale).toBe("flat strip, stepping over it");
    expect(res.decision).toEqual({ source: "model", intent: "walk", target: [700, 520], observed: "a flat shiny strip appeared across the floor", blocked: false });
  });

  it("the same strip judged solid: walking is vetoed and geometry steps around it", async () => {
    const { res } = await second(reply({ obstacles: [{ label: "barrier", box: NEAR_SOLID, solid: true }], change: "a barrier appeared ahead", intent: "walk", reason: "keep going" }));
    expect(res.decision?.source).toBe("veto");
    expect(res.decision?.intent).toBe("walk");
    expect(res.decision?.blocked).toBe(true);
    expect(["A", "D", "ArrowLeft", "ArrowRight"]).toContain(res.action.key);
  });

  it("a step into a side blocked by something solid is vetoed", async () => {
    const { res } = await second(reply({ obstacles: [{ label: "thing", box: NEAR_SOLID, solid: true }], intent: "step_left", reason: "going left", avoiding: true }));
    expect(res.decision?.source).toBe("veto");
    expect(res.action.key).not.toBe("A");
  });

  it("a solid thing further down the hall doesn't veto yet; it is re-checked as the robot approaches", async () => {
    const { res } = await second(reply({ obstacles: [{ label: "far thing", box: [472, 419, 661, 484], solid: true }], intent: "walk", reason: "far off, keep going" }));
    expect([res.action.key, res.decision?.source]).toEqual(["W", "model"]);
  });

  it("otherwise the model's choice stands, e.g. holding to watch something moving nearby", async () => {
    const { res } = await second(reply({ change: "something flutters beside the robot", intent: "hold", reason: "watching the moving thing", avoiding: true }));
    expect([res.action.key, res.decision?.source]).toEqual(["NOOP", "model"]);
  });

  it("mid-stumble the fixed rule holds still, whatever the model chose", async () => {
    const { res } = await second(reply({ pose: "stumbling", intent: "walk", reason: "keep going" }));
    expect([res.action.key, res.mode, res.decision?.source]).toEqual(["NOOP", "unstick", "geometry"]);
  });

  it("arrival stays a fixed rule: threshold in the foreground", async () => {
    const at = reply({ exit: { visible: true, point: [825, 516] }, intent: "walk" });
    const { h } = handler(at, at);
    await h.handle(req(0, b64("at-exit.jpg")));
    const r = await h.handle(req(1, b64("at-exit.jpg")));
    expect([r.mode, r.successClaim, r.decision?.source]).toEqual(["success", true, "geometry"]);
  });

  it("rules mode is unchanged: one image, no decision", async () => {
    const f = fake(JSON.stringify({ robotVisible: true, obstacles: [], exit: { visible: true, point: EXIT }, pose: "upright" }));
    const rules = withRig(loadPolicy("v1"), "shoulder");
    const h = new TickHandler({ adapter: new Er2Perception(f.client, "test", undefined, rules.navigation.shoulder.anchor), policy: rules, taskFor: () => task });
    await h.handle(req(0, b64("clear-route.jpg")));
    const r = await h.handle(req(1, b64("foil-crossing.jpg")));
    expect(r.decision).toBeUndefined();
    expect(f.calls[1]!.contents[0].parts.filter((p: any) => p.inlineData)).toHaveLength(1);
  });

  it("two robots matching the player: holds, whatever the model chose (can't tell which is ours)", async () => {
    const { res } = await second(reply({ robotCount: 2, intent: "step_left", reason: "going around" }));
    expect([res.action.key, res.decision?.source, res.decision?.intent]).toEqual(["NOOP", "geometry", "hold"]);
    expect(res.rationale).toBe("2 robots visible, holding");
  });
});

