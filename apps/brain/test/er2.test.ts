// er2 adapter with a fake client: no network, no key.
import { describe, expect, it } from "vitest";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { Er2Perception, buildScenePrompt, parseScene, type GenAiLike } from "../server/perception/er2.js";
import { loadPolicy } from "../server/policy.js";
import { TickHandler } from "../server/tick.js";
import { EP, req } from "./helpers.js";

const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };
const input = { frame: { mime: "image/jpeg" as const, width: 640, height: 360, b64: "QUJD" }, ...task };
const opts = { timeoutMs: 2500, promptAddenda: [] };

const reply = (o: unknown) => JSON.stringify(o);
const chairAhead = {
  robotVisible: true,
  feet: { left: [753, 362], right: [731, 416] },
  forward: [560, 470],
  obstacles: [{ label: "chair", box: [428, 423, 636, 498] }],
  exit: { visible: true, point: [478, 716] },
  pose: "upright",
};

function fake(...texts: (string | Error)[]) {
  const calls: { model: string; contents: any; config: Record<string, unknown> }[] = [];
  const client: GenAiLike = {
    models: {
      async generateContent(r) {
        calls.push(r as (typeof calls)[number]);
        const next = texts.shift() ?? "";
        if (next instanceof Error) throw next;
        return { text: next };
      },
    },
  };
  return { client, calls };
}

describe("parseScene", () => {
  it("strips code fences, clamps coordinates and fixes inverted boxes", () => {
    const p = parseScene("```json\n" + reply({ ...chairAhead, feet: { left: [1200.4, -3], right: [731, 416] }, obstacles: [{ label: "chair", box: [636, 498, 428, 423] }] }) + "\n```");
    expect(p.scene!.feet.left).toEqual([1000, 0]);
    expect(p.scene!.obstacles[0]!.box).toEqual([428, 423, 636, 498]);
  });

  it("drops degenerate boxes and caps labels at 30 chars", () => {
    const p = parseScene(reply({ ...chairAhead, obstacles: [{ label: "x".repeat(50), box: [1, 1, 1, 5] }, { label: "y".repeat(50), box: [1, 1, 9, 9] }] }));
    expect(p.scene!.obstacles).toHaveLength(1);
    expect(p.obstacleLabels[0]).toHaveLength(30);
  });

  it("has no scene when the robot isn't visible or its feet are missing", () => {
    expect(parseScene(reply({ ...chairAhead, robotVisible: false })).scene).toBeUndefined();
    expect(parseScene(reply({ ...chairAhead, feet: undefined })).scene).toBeUndefined();
  });

  it("throws on non-JSON", () => {
    expect(() => parseScene("I see a robot")).toThrow();
  });
});

describe("Er2Perception", () => {
  it("sends only the frame and the prompt, with the JSON schema and temperature 0", async () => {
    const { client, calls } = fake(reply(chairAhead));
    await new Er2Perception(client, "test-model").perceive(input, opts);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe("test-model");
    const parts = call.contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
    expect(parts[1].text).toBe(buildScenePrompt(input));
    expect(call.config).toMatchObject({ temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 1200 });
    expect(call.config.responseJsonSchema).toBeDefined();
  });

  it("the prompt names the goal and the robot's body, and nothing about the audience", () => {
    const prompt = buildScenePrompt(input).toLowerCase();
    expect(prompt).toContain("goal: exit");
    expect(prompt).toContain("orange backpack");
    for (const w of ["banana", "peel", "ghost", "haunt", "audience", "chair tips", "arrived"]) expect(prompt).not.toContain(w);
  });

  it("returns a scene with labeled hazards and the exit as the target", async () => {
    const { client } = fake(reply(chairAhead));
    const r = await new Er2Perception(client).perceive(input, opts);
    expect(r.scene?.forward).toEqual([560, 470]);
    expect(r.scene?.goal).toEqual([478, 716]);
    expect(r.hazards).toEqual([{ label: "chair", point: [532, 461] }]);
    expect([r.visible, r.point]).toEqual([true, [478, 716]]);
  });

  it("gives a higher thinking effort its own budget plus room for the JSON", async () => {
    const { client, calls } = fake(reply(chairAhead));
    await new Er2Perception(client).perceive(input, { ...opts, thinking: "high" });
    expect(calls[0]!.config).toMatchObject({ thinkingConfig: { thinkingBudget: 2048 }, maxOutputTokens: 3248 });
  });

  it("retries once on unparseable output, then reports a parse error", async () => {
    const once = fake("not json", reply(chairAhead));
    expect((await new Er2Perception(once.client).perceive(input, opts)).scene).toBeDefined();
    expect(once.calls).toHaveLength(2);
    const twice = fake("not json", "still not json");
    expect((await new Er2Perception(twice.client).perceive(input, opts)).error).toBe("parse");
  });

  it("never sends a server deadline (Gemini rejects any under 10 s); enforces the budget with an abort signal", async () => {
    const { client, calls } = fake(reply(chairAhead));
    await new Er2Perception(client).perceive(input, opts);
    expect(calls[0]!.config.httpOptions).toBeUndefined();
    expect(calls[0]!.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("maps API errors to api, even when the message mentions a deadline", async () => {
    const deadline = new Error('{"error":{"code":400,"message":"Manually set deadline 3s is too short. Minimum allowed deadline is 10s."}}');
    const a = new Er2Perception(fake(deadline).client);
    expect((await a.perceive(input, opts)).error).toBe("api");
    expect(a.lastError).toContain("deadline");
    expect((await new Er2Perception(fake(new Error("500 internal")).client).perceive(input, opts)).error).toBe("api");
  });

  it("reports timeout when the budget runs out before ER 2 answers", async () => {
    const slow: GenAiLike = {
      models: {
        generateContent: (r) =>
          new Promise((_, reject) => r.config.abortSignal.addEventListener("abort", () => reject(new Error("This operation was aborted")))),
      },
    };
    const res = await new Er2Perception(slow).perceive(input, { ...opts, timeoutMs: 50 });
    expect(res.error).toBe("timeout");
  });

  it("through the tick handler: ER 2's chair-ahead scene sidesteps right, and a failure falls back", async () => {
    const policy = loadPolicy("v1");
    const ok = new TickHandler({ adapter: new Er2Perception(fake(reply(chairAhead)).client), policy, taskFor: () => task });
    const res = await ok.handle(req(0));
    expect(TickResponse.safeParse(res).success).toBe(true);
    expect([res.mode, res.action.key]).toEqual(["track", "D"]);

    const bad = new TickHandler({ adapter: new Er2Perception(fake(new Error("boom")).client), policy, taskFor: () => task });
    const fb = await bad.handle(req(1));
    expect([fb.mode, fb.action.key, fb.perception.error]).toEqual(["fallback", "NOOP", "api"]);
    expect(fb.episodeId).toBe(EP);
  });
});

describe("facingPoint (forward route from the trailing camera)", () => {
  it("extends a short forward point out to the exit's depth so far obstacles count", async () => {
    const { facingPoint } = await import("../server/navigate.js");
    // boots at y 745, forward a stride up-right at y 689, exit row at y 474
    expect(facingPoint([745, 388], [689, 483], [474, 715], 500)).toEqual([474, 848]);
  });

  it("ignores a forward point level with or behind the boots, falling back to the camera heading", async () => {
    const { facingPoint } = await import("../server/navigate.js");
    expect(facingPoint([747, 525], [823, 532], [465, 467], 500)).toEqual([465, 500]);
    expect(facingPoint([747, 525], [745, 600], [465, 467], 500)).toEqual([465, 500]);
    expect(facingPoint([747, 525], undefined, [465, 467], 500)).toEqual([465, 500]);
  });
});

describe("prefer sidestep on ER 2's live-probe scenes", () => {
  it("furniture far down the hall doesn't block a sidestep; a near armchair does", async () => {
    const { readFileSync } = await import("node:fs");
    const { stepNav, sideClear } = await import("../server/navigate.js");
    const { initialState } = await import("../server/controller.js");
    // A real ER 2 reply, frozen so later probe runs can't change this test.
    const row = JSON.parse(readFileSync(new URL("./fixtures/er2-reply-peel-in-path.json", import.meta.url), "utf8"));
    const scene = parseScene(row.raw).scene!;
    const policy = loadPolicy("v1");
    const facing: [number, number] = [scene.goal![0], policy.navigation.headingX];
    expect(sideClear(scene, facing, "left", policy)).toBe(true); // stools at 0.66 of the way: too far to matter
    expect(sideClear(scene, facing, "right", policy)).toBe(false); // armchair right beside the landing spot
    expect(stepNav(initialState(), scene, req(0), policy).action.key).toBe("A");
  });
});
