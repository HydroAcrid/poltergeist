import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { HauntTag } from "@poltergeist/contracts/common.js";
import type { HauntDispatch } from "@poltergeist/contracts/haunt.js";
import { FakeWorld } from "../dev/fake-world.js";
import { MemoryBus } from "../dev/memory-bus.js";
import { conduct, familyOf, POLICY, type Candidate, type SceneObservation, type Staging } from "../server/conductor.js";
import { createCrowdModule } from "../server/index.js";
import type { CrowdService } from "../server/crowd.js";
import { RulesOnlyModeration } from "../server/moderation/rules.js";

type Fixture = { text: string; tag: HauntTag; staging: Staging };
const idea = (text: string, tag: HauntTag, family: Staging["family"],
  impact: Staging["impact"], placement: Staging["placement"]): Fixture =>
  ({ text, tag, staging: { family, impact, placement } });

const breeze = idea("A cool breeze nudges loose papers down the hallway", "weather", "wind", "subtle", "ambient");
const doubleStorm = "A double hurricane hits the hallway";
const revision = idea("Two tight wind funnels sweep leaves across the aisle", "weather", "wind", "striking", "route");
const chandelier = idea("A chandelier crashes down from the ceiling", "geometry", "barrier", "striking", "route");
const cases = [
  breeze, revision, chandelier,
  idea("A tiny gust lifts the corner of a napkin", "weather", "wind", "subtle", "ambient"),
  idea("A clockwork penguin waddles across the aisle", "distractor", "creature", "striking", "route"),
  idea("Heavy fog rolls into the flashlight beam", "visibility", "fog", "clear", "scene_wide"),
  idea("A red balloon bobs across the beam", "distractor", "balloons", "clear", "route"),
  idea("A brass bell rings once in the distance", "audio", "sound", "subtle", "ambient"),
  idea("A narrow puddle spreads across the floor", "geometry", "water", "clear", "route"),
  idea("A cart tips sideways into the aisle", "geometry", "barrier", "striking", "route"),
  idea("A rubber ball rolls along the robot's path", "geometry", "rolling", "clear", "route"),
  idea("The hallway lamps dim to violet", "lighting", "lighting", "clear", "scene_wide"),
  idea("A banana peel slides across the aisle", "distractor", "slip", "clear", "route"),
  idea("A false door appears on the wall", "sign_change", "direction", "clear", "ambient"),
];
const byText = new Map(cases.map(record => [record.text, record]));
const sceneKinds: SceneObservation["producible"] = ["floor_prop", "airborne", "lighting", "visibility", "sign", "audio", "other"];

describe("the live Crowd scheduler with a varied 300-phone burst", () => {
  it("ranks one checked idea per guest, keeps revisions private and dispatches diverse feasible effects", async () => {
    // Synthetic judgments via the shipping Gemini adapter. No external model or World session.
    let rankings = 0;
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.generationConfig.responseJsonSchema.properties.ranked) {
        rankings++;
        return Response.json({candidates: [{content: {parts: [{text: JSON.stringify({ranked: []})}]}}]});
      }
      expect(body.generationConfig.responseJsonSchema.properties.staging).toBeDefined();
      const { idea: raw } = JSON.parse(body.contents[0].parts[0].text) as {idea: string};
      const fixture = byText.get(raw);
      const value = raw === doubleStorm
        ? { decision: "revise", reason: "scale", suggestion: revision.text }
        : { decision: "accept", text: fixture!.text, tags: [fixture!.tag], staging: fixture!.staging };
      return Response.json({candidates: [{content: {parts: [{text: JSON.stringify(value)}]}}]});
    });
    vi.stubGlobal("fetch", request);
    let now = Date.UTC(2026, 10, 21, 15);
    let collecting = true;
    const readTime = () => collecting ? ++now : now; // deterministic arrival order despite simultaneous submissions
    let stable = true;
    let fresh = true;
    const sent: HauntDispatch[] = [];
    const bus = new MemoryBus(() => now);
    const world = new FakeWorld(bus, () => now);
    bus.subscribe(["haunt.dispatch"], e => { sent.push(e.payload as HauntDispatch); });
    const app = Fastify();
    let crowd!: CrowdService;
    const mod = createCrowdModule({
      now: readTime, autoTick: false, onService: value => { crowd = value; },
      config: { maxPerEpisode: 12, seededFallback: false },
      scene: () => fresh ? {t: 0, observedAt: now, timeRemainingMs: 180_000, cameraStable: stable,
        obstacles: [], producible: sceneKinds, seenHauntIds: sent.map(h => h.hauntId)} : undefined,
    });
    try {
      await mod.register(app, {bus, env: {GEMINI_API_KEY: "fixture"}, dataDir: "./data-test", instance: "local", log() {}});
      await app.ready();
      const inputs = [doubleStorm, ...cases.map(record => record.text)];
      const receipts = await Promise.all(Array.from({length: 300}, (_, i) => app.inject({
        method: "POST", url: "/api/crowd/haunt", payload: {text: inputs[i % inputs.length]},
      })));
      await crowd.whenIdle();
      expect(receipts.every(r => r.statusCode === 200 && r.json().status === "submitted")).toBe(true);
      expect(new Set(receipts.map(r => r.json().hauntId)).size).toBe(300);
      expect(new Set(receipts.map(r => r.headers["set-cookie"])).size).toBe(300);
      expect(request).toHaveBeenCalledTimes(300);
      expect(crowd.eligible()).toHaveLength(280);
      const cookie = String(receipts[0]!.headers["set-cookie"]).split(";")[0]!;
      const privateState = (await app.inject({method: "GET", url: "/api/crowd/state", headers: {cookie}})).json();
      expect(privateState.mine[0]).toMatchObject({status: "rejected", moderated: {safe: false, suggestion: revision.text}});
      expect(crowd.eligible().some(h => h.moderated?.text === doubleStorm)).toBe(false);
      const revised = await app.inject({method: "POST", url: "/api/crowd/haunt", headers: {cookie},
        payload: {revisionOf: privateState.mine[0].hauntId, text: revision.text}});
      expect(revised.statusCode).toBe(200);
      await crowd.whenIdle();
      expect(crowd.eligible()).toHaveLength(281);
      expect(request).toHaveBeenCalledTimes(301); // the lobby does not rank unpublished slots

      collecting = false;
      world.startEpisode({maxDurationMs:90_000, match:{durationMs:180_000,clockMode:"active"}});
      now += 8000;
      stable = false;
      crowd.tick();
      expect(sent).toHaveLength(0); // even a striking effect waits for this camera
      stable = true;
      for (let i = 0; i < 12; i++) {
        // Exercise brief missing observations with the same audience and actual dispatch history.
        fresh = i !== 4;
        crowd.tick();
        expect(sent).toHaveLength(i + 1);
        await world.flush();
        now += 12_000;
      }
      expect(sent[0]!.text).not.toBe(breeze.text);
      expect(sent[4]!.text).not.toBe(breeze.text); // losing the camera never promotes a weak effect over a stronger checked idea
      expect(byText.get(sent[0]!.text)?.staging).toMatchObject({impact: "striking", placement: "route"});
      expect(sent.every(h => h.text !== chandelier.text)).toBe(true);
      const families = sent.map(h => byText.get(h.text)!.staging.family);
      expect(families.every((family, i) => i === 0 || family !== families[i - 1])).toBe(true);
      expect(new Set(families).size).toBeGreaterThanOrEqual(9);
      expect(new Set(sent.map(h => h.hauntId)).size).toBe(12);
      expect(rankings).toBe(12);
      expect(request).toHaveBeenCalledTimes(301 + rankings);
    } finally {
      await mod.close?.();
      await app.close();
      vi.unstubAllGlobals();
    }
  });
});

describe("effect variety without a model", () => {
  const candidate = (id: string, text: string): Candidate =>
    ({hauntId: id, text, createdAt: 0, authorPicksThisRound: 0, skips: 0, tags: ["weather"]});
  it("preserves a breeze, and asks before downsizing paired hurricanes", async () => {
    const rules = new RulesOnlyModeration();
    expect((await rules.moderate("A breeze")).text).toMatch(/breeze/i);
    expect(await rules.moderate("two hurricanes")).toMatchObject({safe: false, suggestion: revision.text});
    expect(await rules.moderate(revision.text)).toMatchObject({safe: true, text: revision.text});
  });
  it("holds near-duplicate wind in a stale scene, even when popular; later releases an uncontested idea", () => {
    const repeated = {...candidate("second", breeze.text), skips: 200};
    const unique = candidate("third", "Balloons drift across the beam");
    const recent = [{hauntId: "first", kind: "airborne" as const, family: familyOf(candidate("first", revision.text)),
      primaryTag: "weather" as const, sentAt: 0, seen: true}];
    expect(conduct([repeated, unique], undefined, recent, 1000).pick?.hauntId).toBe("third");
    expect(conduct([repeated], undefined, recent, 1000).waiting).toMatchObject([{code: "similar"}]);
    expect(conduct([repeated], undefined, recent, POLICY.repeatWindowMs).pick?.hauntId).toBe("second");
  });
});
