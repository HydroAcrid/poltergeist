// Third-person navigation on World's six labeled Player-view frames
// (apps/world/painted-door/haunting/fixtures, World-owned, read-only here),
// using the `fixture` perception adapter. No model calls.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { FixturePerception, WORLD_HALLWAY, loadHallwayLabels } from "../server/perception/fixture.js";
import { buildPrompt } from "../server/perception/prompt.js";
import type { PerceiveOptions, PerceptionAdapter, PerceptionResult, PlayerInput } from "../server/perception/types.js";
import { loadPolicy } from "../server/policy.js";
import { TickHandler } from "../server/tick.js";
import { EP, req } from "./helpers.js";

if (!existsSync(join(WORLD_HALLWAY, "labels.json"))) {
  throw new Error(
    `World's hallway fixtures are missing at ${WORLD_HALLWAY}. They are on origin/codex/world-player-fixtures until World merges them: ` +
      "git restore --source=origin/codex/world-player-fixtures -- apps/world/painted-door/haunting/fixtures",
  );
}

const labels = loadHallwayLabels();
const byFile = Object.fromEntries(labels.frames.map((f) => [f.file, f]));
const b64 = (file: string) => readFileSync(join(WORLD_HALLWAY, file)).toString("base64");

// What the round knows but the player must not.
const PROPOSAL = "Drop a banana peel in the aisle";
const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };
const FORBIDDEN = [PROPOSAL, "banana", "peel", "ghost", "stumbl", "arrived", "slip"];

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
  const handler = new TickHandler({ adapter, policy: loadPolicy("v1"), taskFor: (id) => (id === EP ? task : undefined) });
  return { adapter, handler };
}

// World's current frames are ~93k base64 chars, over C04's 80k cap, so the
// decision tests call run() (past request validation) until World re-exports
// them (#2 REQUEST). The "rejects at the boundary" test below flips when they fit.
async function once(file: string) {
  const { adapter, handler } = setup();
  const res = await handler.run(req(0, b64(file)));
  expect(TickResponse.safeParse(res).success).toBe(true);
  expect(adapter.inner.lastSource).toBe("scene");
  return res;
}

describe("third-person hallway: avoid, recover, arrive", () => {
  it("rejects World's current frames at the HTTP boundary: over C04's 80 000-char b64 cap", async () => {
    // When this fails, World's re-exported frames fit: switch the tests below from run() to handle().
    const { handler } = setup();
    for (const f of labels.frames) await expect(handler.handle(req(0, b64(f.file)))).rejects.toThrow(/80000/);
  });

  it("has all six scenarios World promised", () => {
    expect(Object.keys(byFile).sort()).toEqual(
      ["arrived.jpg", "clear-aisle.jpg", "peel-in-path.jpg", "peel-off-path.jpg", "recovered.jpg", "stumbling.jpg"],
    );
  });

  it("clear aisle: walks ahead", async () => {
    const res = await once("clear-aisle.jpg");
    expect([res.mode, res.action.key]).toEqual(["track", "W"]);
    expect(res.perception.hazards).toEqual([]);
  });

  it("peel in path: steps aside before walking", async () => {
    const res = await once("peel-in-path.jpg");
    expect(res.mode).toBe("track");
    expect(res.action.key).toBe("A"); // obstacle sits just right of the corridor centre → step left
    expect(res.action.holdMs).toBe(600);
    expect(res.rationale).toBe("obstacle ahead, stepping left");
    expect(res.perception.hazards).toEqual([{ label: "obstacle", point: byFile["peel-in-path.jpg"]!.hazard!.point }]);
  });

  it("peel off path: keeps walking, no detour", async () => {
    const res = await once("peel-off-path.jpg");
    expect(res.action.key).toBe("W");
  });

  it("stumbling: holds still instead of stacking a move on the fall", async () => {
    const res = await once("stumbling.jpg");
    expect([res.mode, res.action, res.successClaim]).toEqual(["unstick", { key: "NOOP", holdMs: 0 }, false]);
  });

  it("recovered past the peel: resumes walking (the peel is behind it)", async () => {
    const res = await once("recovered.jpg");
    expect(res.action.key).toBe("W");
  });

  it("arrived: claims arrival only after two ticks with the feet on the threshold", async () => {
    const { handler } = setup();
    const first = await handler.run(req(0, b64("arrived.jpg")));
    expect([first.mode, first.successClaim]).toEqual(["success", false]);
    const second = await handler.run(req(1, b64("arrived.jpg")));
    expect([second.mode, second.successClaim, second.action.key]).toEqual(["success", true, "NOOP"]);
    expect(second.rationale).toMatch(/^feet at exit threshold \(gap \d+\)$/);
  });

  it("its arrival claims match World's labels on every frame", async () => {
    for (const f of labels.frames) {
      const { handler } = setup();
      await handler.run(req(0, b64(f.file)));
      const res = await handler.run(req(1, b64(f.file)));
      expect(res.successClaim, f.file).toBe(f.arrived);
    }
  });

  it("walks through the scripted route: clear → avoid → stumble → recover → arrive", async () => {
    const { handler } = setup();
    const route = ["clear-aisle.jpg", "peel-in-path.jpg", "stumbling.jpg", "recovered.jpg", "arrived.jpg", "arrived.jpg"];
    const keys = [];
    for (const [seq, file] of route.entries()) keys.push((await handler.run(req(seq, b64(file)))).action.key);
    expect(keys).toEqual(["W", "A", "NOOP", "W", "NOOP", "NOOP"]);
  });

  it("gives the player only the frame and the task: no proposal, ghost cue or labels", async () => {
    const { adapter, handler } = setup();
    for (const [seq, f] of labels.frames.entries()) {
      await handler.run(req(seq, b64(f.file), { recentHaunts: [{ hauntId: "ht_01JDPG00000000000000000002", t: 0, tags: ["geometry"] }] }));
    }
    expect(adapter.calls).toHaveLength(6);
    for (const { input, prompt } of adapter.calls) {
      expect(Object.keys(input).sort()).toEqual(["frame", "instruction", "targetLabel"]);
      const text = `${input.targetLabel}\n${input.instruction}\n${prompt}`.toLowerCase();
      for (const word of FORBIDDEN) expect(text).not.toContain(word.toLowerCase());
      for (const f of labels.frames) expect(text).not.toContain(`${f.goal[0]}, ${f.goal[1]}`);
    }
  });
});
