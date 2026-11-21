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


describe("hold cap (decision.maxHolds)", () => {
  const holdReply = (obstacles: unknown[] = []) => reply({ obstacles, change: "something appeared", intent: "hold", reason: "waiting to see", avoiding: true });

  async function run(n: number, text: string) {
    const { h } = handler(...Array(n).fill(text));
    const keys: string[] = [];
    const sources: (string | undefined)[] = [];
    for (let seq = 0; seq < n; seq++) {
      const r = await h.handle(req(seq, b64("foil-crossing.jpg")));
      keys.push(r.action.key);
      sources.push(r.decision?.source);
    }
    return { keys, sources };
  }

  it("holds up to maxHolds (4) ticks, then geometry moves, then the model decides again", async () => {
    expect(policy.decision.maxHolds).toBe(4);
    const { keys, sources } = await run(7, holdReply([{ label: "flat strip", box: FOIL_ACROSS, solid: false }]));
    expect(keys).toEqual(["NOOP", "NOOP", "NOOP", "NOOP", "W", "NOOP", "NOOP"]);
    expect(sources).toEqual(["model", "model", "model", "model", "geometry", "model", "model"]);
  });

  it("past the cap it still won't walk into something the model called solid", async () => {
    const { keys } = await run(5, holdReply([{ label: "barrier", box: NEAR_SOLID, solid: true }]));
    expect(keys.slice(0, 4)).toEqual(["NOOP", "NOOP", "NOOP", "NOOP"]);
    expect(keys[4]).not.toBe("W");
    expect(keys[4]).not.toBe("NOOP");
  });

  it("any non-hold choice resets the streak", async () => {
    const texts = [holdReply(), holdReply(), holdReply(), reply({ intent: "walk" }), holdReply(), holdReply(), holdReply(), holdReply()];
    const { h } = handler(...texts);
    const keys: string[] = [];
    for (let seq = 0; seq < texts.length; seq++) keys.push((await h.handle(req(seq, b64("clear-route.jpg")))).action.key);
    expect(keys).toEqual(["NOOP", "NOOP", "NOOP", "W", "NOOP", "NOOP", "NOOP", "NOOP"]);
  });

  it("safety holds don't count: two robots keep holding past the cap", async () => {
    const { keys } = await run(6, reply({ robotCount: 2, intent: "hold" }));
    expect(keys).toEqual(Array(6).fill("NOOP"));
  });
});

describe("steadier decisions (decision.steady)", () => {
  const run = async (...texts: string[]) => {
    const { h, calls } = handler(...texts);
    const out = [];
    for (let seq = 0; seq < texts.length; seq++) out.push(await h.handle(req(seq, b64("clear-route.jpg"))));
    return { out, calls };
  };

  it("a non-urgent switch waits for a second look; the plan continues meanwhile", async () => {
    const { out } = await run(
      reply({ intent: "step_right", avoiding: true, reason: "bucket ahead" }),
      reply({ intent: "walk", reason: "way clear" }),
      reply({ intent: "walk", reason: "way clear" }),
    );
    expect(out.map((r) => r.action.key)).toEqual(["D", "D", "W"]);
    expect(out.map((r) => r.decision?.source)).toEqual(["model", "steady", "model"]);
    expect(out[1]!.rationale).toBe("keeping step right; 2nd look before walk");
  });

  it("a newly avoided hazard and a hold switch at once", async () => {
    const hazard = await run(reply({ intent: "walk" }), reply({ intent: "step_left", avoiding: true }));
    expect(hazard.out.map((r) => r.action.key)).toEqual(["W", "A"]);
    const hold = await run(reply({ intent: "walk" }), reply({ intent: "hold" }));
    expect(hold.out.map((r) => r.action.key)).toEqual(["W", "NOOP"]);
  });

  it("flip-flopping proposals on an unchanged scene no longer flip the robot", async () => {
    // take 1's real sequence: step_right, walk, walk, step_right, step_right, turn_right
    const { out } = await run(
      reply({ intent: "step_right", avoiding: true }), reply({ intent: "walk" }), reply({ intent: "walk" }),
      reply({ intent: "step_right", avoiding: true }), reply({ intent: "step_right", avoiding: true }), reply({ intent: "turn_right" }),
    );
    expect(out.map((r) => r.action.key)).toEqual(["D", "D", "W", "D", "D", "D"]);
  });

  it("tells the model its previous move from the second tick", async () => {
    const { calls } = await run(reply({ intent: "walk" }), reply({ intent: "walk" }));
    const prompt = (c: any) => c.contents[0].parts.at(-1).text as string;
    expect(prompt(calls[0])).not.toContain("Your previous move was");
    expect(prompt(calls[1])).toContain("Your previous move was walk.");
    expect(prompt(calls[1])).toContain("Keep to the current plan unless the images show something new");
  });
});

describe("hold when the robot looks too small (shoulder.minRobotWidth)", () => {
  it("holds when the robot's body is under 20% of the frame width", async () => {
    const { res } = await second(reply({ robotBox: [300, 120, 900, 280], intent: "walk" }));
    expect([res.action.key, res.decision?.source, res.rationale]).toEqual(["NOOP", "geometry", "robot too small in frame, holding"]);
  });
  it("acts normally at take 1's widths (23-30%)", async () => {
    const { res } = await second(reply({ robotBox: [262, 143, 903, 375], intent: "walk" }));
    expect([res.action.key, res.decision?.source]).toEqual(["W", "model"]);
  });
});

describe("plan the next move (decision.next + useNext)", () => {
  it("reports the model's planned follow-up as decision.next", async () => {
    const { res } = await second(reply({ intent: "step_right", avoiding: true, then: "walk" }));
    expect(res.decision?.next).toBe("walk");
  });

  it("when the next look fails, carries out the planned move if the last scene showed it clear", async () => {
    const { h } = handler(reply({ intent: "walk", then: "walk" }), "not json", "still not json");
    await h.handle(req(0, b64("clear-route.jpg")));
    const late = await h.handle(req(1, b64("clear-route.jpg")));
    expect([late.action.key, late.mode, late.decision?.source]).toEqual(["W", "fallback", "steady"]);
    expect(late.rationale).toBe("look late, doing planned walk");
  });

  it("doesn't carry out a planned walk into something solid; falls back to holding", async () => {
    const { h } = handler(reply({ obstacles: [{ label: "barrier", box: NEAR_SOLID, solid: true }], intent: "step_right", avoiding: true, then: "walk" }), "not json", "still not json");
    await h.handle(req(0, b64("clear-route.jpg")));
    const late = await h.handle(req(1, b64("clear-route.jpg")));
    expect(late.action.key).not.toBe("W");
    expect(late.mode).toBe("fallback");
  });
});
