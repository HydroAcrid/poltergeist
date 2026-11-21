import { describe, expect, it } from "vitest";
import type { Perception } from "@poltergeist/contracts/tick-response.js";
import { initialState, step, type ControllerState } from "../server/controller.js";
import type { Resolved } from "../server/perception/resolve.js";
import { resolvePerception } from "../server/perception/resolve.js";
import { loadPolicy } from "../server/policy.js";
import { req } from "./helpers.js";

const policy = loadPolicy("v1");
const seen = (p: Partial<Perception>): Resolved => ({
  perception: { visible: true, conf: 0.9, hazards: [], model: "test", latencyMs: 0, ...p } as Perception,
});
const lost = seen({ visible: false, point: undefined, conf: 0.1 });

describe("controller", () => {
  it("turns toward an off-centre target, scaled by kYaw and clamped", () => {
    const r = step(initialState(), seen({ point: [400, 800], box: [300, 750, 500, 850] }), req(0), policy);
    expect(r.mode).toBe("track");
    expect(r.action).toEqual({ key: "ArrowRight", holdMs: 360 }); // e = 0.6 → 600·0.6
    const l = step(initialState(), seen({ point: [400, 50] }), req(0), policy);
    expect(l.action).toEqual({ key: "ArrowLeft", holdMs: 540 });
  });

  it("walks forward when centred, shorter as the box grows", () => {
    const far = step(initialState(), seen({ point: [400, 520], box: [350, 480, 450, 560] }), req(0), policy);
    expect(far.action).toEqual({ key: "W", holdMs: 1080 }); // 1200·(1 − 0.1)
    const noBox = step(initialState(), seen({ point: [400, 520] }), req(0), policy);
    expect(noBox.action).toEqual({ key: "W", holdMs: 600 });
  });

  it("searches after lostTicksBeforeSearch, then explores forward after searchMaxSteps", () => {
    let s: ControllerState = initialState();
    const keys: string[] = [];
    for (let i = 0; i < 11; i++) {
      const r = step(s, lost, req(i), policy);
      expect(r.mode).toBe("search");
      keys.push(r.action.key);
      s = r.state;
    }
    expect(keys).toEqual(["NOOP", ...Array(8).fill("ArrowRight"), "W", "ArrowRight"]);
  });

  it("unsticks over two ticks when W isn't moving the frame", () => {
    const stuck = (seq: number) => req(seq, "AAAA", { executing: { key: "W", holdMs: 800, startedT: 0 }, frameDiff: 0.005 });
    const ahead = seen({ point: [400, 500] });
    let r = step(initialState(), ahead, stuck(0), policy);
    expect(r.mode).toBe("track");
    r = step(r.state, ahead, stuck(1), policy);
    expect([r.mode, r.action]).toEqual(["unstick", { key: "S", holdMs: 400 }]);
    r = step(r.state, ahead, req(2), policy);
    expect([r.mode, r.action]).toEqual(["unstick", { key: "ArrowLeft", holdMs: 300 }]);
  });

  it("claims success only after successTicks consecutive big, centred ticks", () => {
    const close = seen({ point: [450, 510], box: [100, 400, 700, 620] });
    const a = step(initialState(), close, req(0), policy);
    expect(a.successClaim).toBe(false);
    const b = step(a.state, close, req(1), policy);
    expect([b.mode, b.successClaim, b.action.key]).toEqual(["success", true, "NOOP"]);
  });

  it("never claims success when a human is driving", () => {
    const close = seen({ point: [450, 510], box: [100, 400, 700, 620] });
    const human = (seq: number) => req(seq, "AAAA", { driver: "human" });
    const a = step(initialState(), close, human(0), policy);
    const b = step(a.state, close, human(1), policy);
    expect(b.mode).toBe("success");
    expect(b.successClaim).toBe(false);
  });

  it("falls back to half the last track move within 1500 ms, otherwise NOOP", () => {
    const tracked = step(initialState(), seen({ point: [400, 800] }), req(0), policy);
    const failed = seen({ visible: false, point: undefined, conf: 0, error: "timeout" });
    const soon = step(tracked.state, failed, req(2), policy); // t = 1000
    expect([soon.mode, soon.action]).toEqual(["fallback", { key: "ArrowRight", holdMs: 180 }]);
    const late = step(tracked.state, failed, req(4), policy); // t = 2000
    expect([late.mode, late.action]).toEqual(["fallback", { key: "NOOP", holdMs: 0 }]);
  });

  it("ignores a low-confidence jump larger than maxPointJump", () => {
    const a = step(initialState(), seen({ point: [400, 500] }), req(0), policy);
    const b = step(a.state, seen({ point: [400, 950], conf: 0.5 }), req(1), policy);
    expect(b.state.emaPoint).toEqual([400, 500]);
    const c = step(a.state, seen({ point: [400, 950], conf: 0.85 }), req(1), policy);
    expect(c.state.emaPoint).toEqual([400, 725]);
  });

  it("keeps every rationale within 60 characters", () => {
    const r = step(initialState(), seen({ point: [400, 800] }), req(0), policy);
    expect(r.rationale.length).toBeLessThanOrEqual(60);
  });
});

describe("resolvePerception", () => {
  const base = { visible: true, conf: 0.6, hazards: [], model: "t", latencyMs: 0 };
  it("drops flat candidates and picks the single recessed one", () => {
    const r = resolvePerception({
      ...base,
      candidates: [
        { point: [300, 100], conf: 0.9, depth: "flat" },
        { point: [300, 700], conf: 0.6, depth: "recessed" },
      ],
    });
    expect(r.ambiguous).toBeUndefined();
    expect(r.perception.point).toEqual([300, 700]);
  });

  it("reports not-visible with unconfirmed candidates when nothing tells them apart", () => {
    const r = resolvePerception({
      ...base,
      candidates: [
        { point: [300, 100], conf: 0.6, depth: "unclear" },
        { point: [300, 700], conf: 0.6, depth: "unclear" },
      ],
    });
    expect(r.ambiguous).toHaveLength(2);
    expect(r.perception.visible).toBe(false);
    expect(r.perception.point).toBeUndefined();
  });

  it("reports not-visible when every candidate is flat", () => {
    const r = resolvePerception({ ...base, candidates: [{ point: [1, 1], conf: 0.9, depth: "flat" }, { point: [2, 2], conf: 0.9, depth: "flat" }] });
    expect(r.perception.visible).toBe(false);
  });
});

describe("TickLog reaction from the first-person controller", () => {
  it("flags a stall while pushing W as unclear, not a stumble", () => {
    const stuck = (seq: number) => req(seq, "AAAA", { executing: { key: "W", holdMs: 800, startedT: 0 }, frameDiff: 0.005 });
    const ahead = seen({ point: [400, 500] });
    const a = step(initialState(), ahead, stuck(0), policy);
    expect(a.reaction).toBeUndefined();
    const b = step(a.state, ahead, stuck(1), policy);
    expect([b.mode, b.reaction]).toEqual(["unstick", "unclear"]);
  });
});
