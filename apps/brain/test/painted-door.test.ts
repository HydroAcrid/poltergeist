// The player's first movement choice on World's recorded painted-door frames,
// using the `fixture` perception adapter (no model calls).
import { describe, expect, it } from "vitest";
import { HIT_RADIUS } from "@poltergeist/contracts/replay.js";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { FixturePerception, loadLabels } from "../server/perception/fixture.js";
import { buildPrompt } from "../server/perception/prompt.js";
import type { PerceiveOptions, PerceptionAdapter, PerceptionResult, PlayerInput } from "../server/perception/types.js";
import { loadPolicy } from "../server/policy.js";
import { TickHandler } from "../server/tick.js";
import { EP, dist, frameB64, req } from "./helpers.js";

const HEAD_ON = "painted-door-head-on.jpg";
const SIDEWAYS = "painted-door-sideways.jpg";

// What the round knows but the player must not: the ghost's haunting and the answer.
const GHOST_PROMPT = "Paint a life-size red exit door directly onto the blank left half of the wall.";
const episode = {
  episodeId: EP,
  seed: { kind: "image", prompt: "A long hotel hallway with a green exit door set into a recessed alcove on the right." },
  task: { targetLabel: "exit door", instruction: "Walk through the exit door in this hallway." },
  haunts: [{ text: GHOST_PROMPT, tags: ["distractor"] }],
};
const truth = Object.fromEntries(loadLabels().map((l) => [l.file, l]));
const FORBIDDEN = [GHOST_PROMPT, "paint", "red", "green", "recessed alcove", "decoy", "real door", "fake", "hotel hallway"];

/** Wraps the fixture adapter and records exactly what the player handed it. */
class Recording implements PerceptionAdapter {
  readonly name = "fixture" as const;
  readonly inner = new FixturePerception();
  readonly calls: { input: PlayerInput; prompt: string }[] = [];
  async perceive(input: PlayerInput, opts: PerceiveOptions): Promise<PerceptionResult> {
    this.calls.push({ input, prompt: buildPrompt(input, opts.promptAddenda) });
    return this.inner.perceive(input, opts);
  }
}

function setup() {
  const adapter = new Recording();
  const handler = new TickHandler({ adapter, policy: loadPolicy("v1"), taskFor: (id) => (id === EP ? episode.task : undefined) });
  return { adapter, handler };
}

describe("painted door: first movement choice", () => {
  it("head-on, with two look-alike doors, changes the viewing angle instead of walking to either", async () => {
    const { adapter, handler } = setup();
    const res = await handler.handle(req(0, frameB64(HEAD_ON)));

    expect(TickResponse.safeParse(res).success).toBe(true);
    expect(adapter.inner.lastSource).toBe("observation");
    expect(res.mode).toBe("search");
    expect(res.action).toEqual({ key: "D", holdMs: 1000 }); // the recorded sidestep
    expect(res.successClaim).toBe(false);
    expect(res.perception.visible).toBe(false);
    expect(res.perception.hazards.filter((h) => h.label === "unconfirmed door")).toHaveLength(2);
    expect(res.rationale).toBe("2 doors, side-stepping to check depth");
  });

  it("after the sidestep, commits to the recessed door and turns toward it, not the painting", async () => {
    const { adapter, handler } = setup();
    await handler.handle(req(0, frameB64(HEAD_ON)));
    const res = await handler.handle(req(1, frameB64(SIDEWAYS)));

    expect(adapter.inner.lastSource).toBe("observation");
    expect(res.mode).toBe("track");
    expect(res.perception.visible).toBe(true);
    const label = truth[SIDEWAYS]!;
    expect(dist(res.perception.point!, label.point!)).toBeLessThanOrEqual(HIT_RADIUS);
    expect(dist(res.perception.point!, label.decoys![0]!.point)).toBeGreaterThan(HIT_RADIUS);
    // Exit at x≈644 → e≈0.29: a short right turn, not a walk toward the painting on the left.
    expect(res.action.key).toBe("ArrowRight");
    expect(res.action.holdMs).toBeGreaterThanOrEqual(120);
    expect(res.action.holdMs).toBeLessThanOrEqual(600);
    expect(res.rationale).toBe("door 1 o'clock → turning");
  });

  it("starting from the sideways frame, commits immediately with no verification step", async () => {
    const { handler } = setup();
    const res = await handler.handle(req(0, frameB64(SIDEWAYS)));
    expect(res.mode).toBe("track");
    expect(res.action.key).toBe("ArrowRight");
  });

  it("if both doors stay ambiguous, it verifies at most twice and then commits to the likelier one", async () => {
    const { handler } = setup();
    const moves = [];
    for (let seq = 0; seq < 3; seq++) moves.push(await handler.handle(req(seq, frameB64(HEAD_ON))));
    expect(moves.map((m) => m.action.key)).toEqual(["D", "D", "ArrowRight"]);
    expect(moves[2]!.mode).toBe("track");
  });

  it("never gives the player the ghost's prompt, the world seed or which door is real", async () => {
    const { adapter, handler } = setup();
    await handler.handle(req(0, frameB64(HEAD_ON)));
    await handler.handle(req(1, frameB64(SIDEWAYS), { recentHaunts: [{ hauntId: "ht_01JDPG00000000000000000001", t: 400, tags: ["distractor"] }] }));

    expect(adapter.calls).toHaveLength(2);
    for (const { input, prompt } of adapter.calls) {
      expect(Object.keys(input).sort()).toEqual(["frame", "instruction", "targetLabel"]);
      expect(Object.keys(input.frame).sort()).toEqual(["b64", "height", "mime", "width"]);
      const text = `${input.targetLabel}\n${input.instruction}\n${prompt}`.toLowerCase();
      for (const word of FORBIDDEN) expect(text).not.toContain(word.toLowerCase());
      // No coordinates of either door appear in what the player is given.
      for (const l of Object.values(truth)) expect(text).not.toContain(`${l.point![0]}, ${l.point![1]}`);
    }
  });
});
