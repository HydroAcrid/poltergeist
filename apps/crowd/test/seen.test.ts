// Interim "Seen in the hallway" rule. The inline ticks mirror Brain's fixtures
// fixtures/scenarios/{hazard-after-haunt,no-hazard-after-haunt} (brain/contracts 6a876ba).
// A consumer test that reads those files directly lands once Brain's fixtures are on main.
import { describe, expect, it } from "vitest";
import { detectSeen, type SeenTick } from "../server/seen.js";

const tick = (seq: number, hazards: string[] = [], rationale = "path clear, walking"): SeenTick => ({
  seq, t: seq * 500, perception: { hazards: hazards.map((label) => ({ label })) }, rationale,
});
const walk = (from: number, to: number, hazards: string[] = []) => Array.from({ length: to - from + 1 }, (_, i) => tick(from + i, hazards));

describe("detectSeen", () => {
  it("hazard-after-haunt: chair injected at 8.0 s is seen at 9.5 s (seq 19) with the robot's response", () => {
    const ticks = [...walk(0, 18), tick(19, ["chair"], "obstacle ahead, turning toward exit"), ...walk(20, 25, ["chair"])];
    expect(detectSeen({ hauntId: "ht_chair", t: 8000, ok: true }, ticks)).toEqual({
      seen: true, hauntId: "ht_chair", t: 9500, seq: 19, label: "chair", response: "obstacle ahead, turning toward exit",
    });
  });

  it("no-hazard-after-haunt: nothing new through 14 s stays 'Sent to world'", () => {
    expect(detectSeen({ hauntId: "ht_mop", t: 8000, ok: true }, walk(0, 28))).toEqual({ seen: false, hauntId: "ht_mop" });
  });

  it("ignores hazards that were already there before the injection", () => {
    const ticks = [...walk(0, 18, ["chair"]), ...walk(19, 25, ["chair"])];
    expect(detectSeen({ hauntId: "h", t: 8000, ok: true }, ticks).seen).toBe(false);
  });

  it("only looks inside the 6 s window", () => {
    const ticks = [...walk(0, 28), tick(29, ["bucket"])]; // 14.5 s, 6.5 s after injection
    expect(detectSeen({ hauntId: "h", t: 8000, ok: true }, ticks).seen).toBe(false);
  });

  it("never marks a failed injection as seen", () => {
    expect(detectSeen({ hauntId: "h", t: 8000, ok: false }, [tick(19, ["chair"])]).seen).toBe(false);
  });
});
