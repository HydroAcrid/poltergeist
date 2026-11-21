// Ghost veil timing rules: never expose the scene mid-sweep; an early part() waits for full coverage.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser JS module, no type declarations
import { createVeilMachine } from "../web/veil/veil-machine.js";

describe("ghost veil state machine", () => {
  it("sweeps, holds (covered), parts and goes", () => {
    const m = createVeilMachine();
    expect(m.state).toBe("idle");
    expect(m.cover()).toBe("sweeping");
    expect(m.isCovered).toBe(false);
    expect(m.coverDone()).toBe("holding");
    expect(m.isCovered).toBe(true);
    expect(m.part()).toBe("parting");
    expect(m.partDone()).toBe("gone");
  });

  it("a part() during the sweep waits until coverage is complete", () => {
    const m = createVeilMachine();
    const seen: string[] = [];
    m.onChange((s: string) => seen.push(s));
    m.cover();
    expect(m.part()).toBe("sweeping"); // not exposed early
    m.coverDone();
    expect(seen).toEqual(["sweeping", "holding", "parting"]); // holds full coverage first, then parts
  });

  it("holds as long as it takes when the round is slow to start", () => {
    const m = createVeilMachine();
    m.cover();
    m.coverDone();
    for (let i = 0; i < 100; i++) m.coverDone(); // Genie still preparing
    expect(m.state).toBe("holding");
  });

  it("ignores out-of-order events and can cover again for the next round", () => {
    const m = createVeilMachine();
    expect(m.part()).toBe("idle");
    expect(m.partDone()).toBe("idle");
    m.cover(); m.coverDone(); m.part(); m.partDone();
    expect(m.cover()).toBe("sweeping");
  });
});
