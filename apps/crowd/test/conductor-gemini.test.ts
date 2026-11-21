// Gemini-powered live show conductor: ranks rule-feasible ideas for the current hallway moment,
// keeps keys in #private fields with failover + redaction + per-minute cap, sanitizes reasons,
// deduplicates per slot in CrowdService, and falls back deterministically within budget.
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { MemoryBus } from "../dev/memory-bus.js";
import { FakeWorld } from "../dev/fake-world.js";
import { GeminiConductorAgent } from "../server/conductor-agent.js";
import { CrowdService } from "../server/crowd.js";
import { loadPresets, loadSeededPool } from "../server/load.js";
import { RulesOnlyModeration } from "../server/moderation/rules.js";

const KEY_1 = "AIzaFAKE-conductor-key-1-0000000000";
const KEY_2 = "AIzaFAKE-conductor-key-2-1111111111";

const geminiRankReply = (ranked: { hauntId: string; reason: string }[]) =>
  Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ ranked }) }] } }],
  });

describe("GeminiConductorAgent security and failover", () => {
  it("ranks feasible candidates using x-goog-api-key header and never exposes keys on inspect/serialize", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      geminiRankReply([
        { hauntId: "ht_2", reason: "Fog dims the beam right as the aisle opens" },
        { hauntId: "ht_1", reason: "Good backup prop" },
      ]),
    );
    const agent = new GeminiConductorAgent([KEY_1, KEY_2], "gemini-4-hydrogen", request);
    expect(JSON.stringify(agent)).not.toMatch(/AIza/);
    expect(inspect(agent, { depth: 5, showHidden: true })).not.toMatch(/AIza/);

    const ranked = await agent.rank({
      candidates: [
        { hauntId: "ht_1", text: "A banana peel lands in the aisle", tags: ["geometry"], family: "slip" },
        { hauntId: "ht_2", text: "Thick fog rolls down the hallway", tags: ["visibility"], family: "fog" },
      ],
      scene: {
        t: 8000,
        observedAt: 10_000,
        robotProgress: 0.25,
        timeRemainingMs: 45_000,
        cameraStable: true,
        obstacles: [],
        producible: ["floor_prop", "visibility"],
        seenHauntIds: [],
      },
      recent: [],
    });

    expect(ranked[0]).toEqual({ hauntId: "ht_2", reason: "Fog dims the beam right as the aisle opens" });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).not.toMatch(/AIza|key=/i);
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY_1);
  });

  it("fails over to key 2 on 429/5xx, scrubs keys from fault logs, and enforces per-minute cap", async () => {
    let t = 1_000;
    const faults: string[] = [];
    const request = vi.fn<typeof fetch>(async (_u, init) => {
      const k = (init!.headers as Record<string, string>)["x-goog-api-key"];
      if (k === KEY_1) return new Response(`quota exceeded for ${KEY_1}`, { status: 429 });
      return geminiRankReply([{ hauntId: "ht_2", reason: "Lighting shift fills the whole corridor" }]);
    });
    const agent = new GeminiConductorAgent([KEY_1, KEY_2], "gemini-4-hydrogen", request, (f) => faults.push(f), {
      now: () => t,
      maxPerMinute: 1,
    });

    const ctx = {
      candidates: [
        { hauntId: "ht_1", text: "A chair tips over", tags: ["geometry" as const], family: "barrier" },
        { hauntId: "ht_2", text: "The hallway lights flicker", tags: ["lighting" as const], family: "lighting" },
      ],
      recent: [],
    };
    const first = await agent.rank(ctx);
    expect(first[0]?.hauntId).toBe("ht_2");
    expect(faults.join(" ")).not.toMatch(/AIza/);

    // Over the 1/min cap: returns [] without calling Gemini again, so deterministic rules keep their pick.
    request.mockClear();
    expect(await agent.rank(ctx)).toEqual([]);
    expect(request).not.toHaveBeenCalled();

    t += 60_001;
    expect((await agent.rank(ctx))[0]?.hauntId).toBe("ht_2");
  });
});

describe("CrowdService with Gemini conductor agent", () => {
  it("upgrades the reserved Up next pick asynchronously with Gemini's display-safe choice, once per slot", async () => {
    let now = 1_000_000;
    const bus = new MemoryBus(() => now);
    const world = new FakeWorld(bus, () => now);
    const request = vi.fn<typeof fetch>(async (_u, init) => {
      const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
      const ids = [...prompt.matchAll(/"hauntId":"(ht_[A-Z0-9]+)"/g)].map((m) => m[1]!);
      // Pick the second feasible idea (lights-flicker) over the first (banana-peel).
      return geminiRankReply([{ hauntId: ids[1]!, reason: "Flickering lights rattle the beam before the turn" }]);
    });
    const conductorAgent = new GeminiConductorAgent([KEY_1], "gemini-4-hydrogen", request, undefined, { now: () => now });
    const crowd = new CrowdService({
      bus,
      moderation: new RulesOnlyModeration(),
      presets: loadPresets(),
      seededPool: loadSeededPool(),
      now: () => now,
      conductorAgent,
      scene: () => ({
        t: 1000,
        observedAt: now,
        robotProgress: 0.2,
        timeRemainingMs: 50_000,
        cameraStable: true,
        obstacles: [],
        producible: ["floor_prop", "airborne", "lighting", "visibility", "sign", "audio", "other"],
        seenHauntIds: [],
      }),
    });

    const r1 = crowd.submit("dv_aaaaaaaaaaaaaaaa", { preset: "banana-peel" });
    now += 1000;
    const r2 = crowd.submit("dv_bbbbbbbbbbbbbbbb", { preset: "lights-flicker" });
    await crowd.whenIdle();
    expect(r1.ok && r2.ok).toBe(true);

    world.startEpisode();
    crowd.tick();
    await crowd.whenIdle();

    const state = crowd.state("dv_aaaaaaaaaaaaaaaa");
    expect(state.upNext).toEqual({
      hauntId: (r2 as { ok: true; hauntId: string }).hauntId,
      reason: "Flickering lights rattle the beam before the turn",
      mode: "conductor",
    });

    // Repeated ticks on the same candidate set do not re-query Gemini.
    crowd.tick();
    crowd.tick();
    await crowd.whenIdle();
    expect(request).toHaveBeenCalledTimes(1);
    crowd.stop();
  });
});
